// @vitest-environment node
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import SwaggerParser from "@apidevtools/swagger-parser"
import Ajv2020, { type AnySchema } from "ajv/dist/2020"
import { beforeAll, expect, test, vi } from "vitest"
import { scopeDescription, scopeName } from "../../lib/api-scopes"
import type { ApiRouteOptions } from "./route"
import { buildOpenApi, type OpenApiDocument } from "./openapi"

const registrations = vi.hoisted(
  () => [] as Pick<ApiRouteOptions, "method" | "path" | "scope">[]
)
vi.mock("./route", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./route")>()
  return {
    ...actual,
    apiRoute: (...args: Parameters<typeof actual.apiRoute>) => {
      const { method, path, scope } = args[1]
      registrations.push({ method, path, scope })
      return actual.apiRoute(...args)
    },
  }
})
import "../http"

let source: OpenApiDocument
let document: OpenApiDocument
beforeAll(async () => {
  source = (await SwaggerParser.parse(
    resolve("openapi/opensend.yaml")
  )) as unknown as OpenApiDocument
  document = buildOpenApi(source)
})
const table = readFileSync(resolve("docs/qa/dx-parity.md"), "utf8")
  .split("\n")
  .filter((line) => /^\| (GET|POST|PATCH|DELETE) \|/.test(line))
  .map((line) =>
    line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim())
  )
const exceptions = JSON.parse(
  readFileSync(resolve("packages/sdk/test/rest-parity-exceptions.json"), "utf8")
) as Record<string, string>
const unquote = (cell: string) => cell.replaceAll("`", "")

test("every registered REST route is inventoried with SDK and MCP coverage or an exact reason", () => {
  const actual = registrations
    .map(({ method, path }) => `${method} ${path}`)
    .sort()
  const inventoried = table
    .map(([method, path]) => `${method} ${unquote(path)}`)
    .sort()
  const documented = Object.entries(source.paths)
    .flatMap(([path, methods]) =>
      Object.keys(methods)
        .filter((method) => ["get", "post", "patch", "delete"].includes(method))
        .map((method) => `${method.toUpperCase()} ${path}`)
    )
    .sort()
  expect(actual.length).toBeGreaterThan(0)
  expect(new Set(actual).size).toBe(actual.length)
  expect(inventoried).toEqual(actual)
  expect(documented).toEqual(actual)
  for (const [method, path, scope, sdk, mcp, note] of table) {
    const key = `${method} ${unquote(path)}`
    const registration = registrations.find(
      (route) => `${route.method} ${route.path}` === key
    )!
    expect(scope.split(";")[0]).toBe(`\`${scopeName(registration.scope)}\``)
    if (key in exceptions) {
      expect(note).toBe(exceptions[key])
      expect(sdk).toBe("—")
      expect(mcp).toBe("—")
    } else {
      expect(sdk, key).toMatch(/`[^`]+`/)
      expect(mcp, key).toMatch(/`[^`]+`/)
    }
  }
  expect(
    Object.keys(exceptions).filter((key) => !actual.includes(key))
  ).toEqual([])
})

test("raw and enriched scope documentation matches enforced route permissions", () => {
  for (const { method, path, scope } of registrations) {
    const context = `${method} ${path}`
    const name = scopeName(scope)
    const raw = source.paths[path][method.toLowerCase()]
    const enriched = document.paths[path][method.toLowerCase()]
    expect(raw["x-opensend-scope"], context).toBe(name)
    expect(enriched["x-opensend-scope"], context).toBe(name)
    if (scope !== "full_access")
      expect(enriched.description, context).toContain(scopeDescription(name))
    if (path.startsWith("/ivrs") || path.startsWith("/domains"))
      expect(raw.description, context).toContain(scopeDescription(name))
  }
})

test("413 uses one response/schema for routes accepting bounded request bodies", () => {
  const components = source.components as {
    responses: Record<
      string,
      { content: { "application/json": { schema: { $ref: string } } } }
    >
    schemas: Record<
      string,
      {
        properties: { statusCode: { const: number }; name: { enum: string[] } }
      }
    >
  }
  expect(
    components.responses.Error413.content["application/json"].schema.$ref
  ).toBe("#/components/schemas/Error413")
  expect(components.schemas.Error413.properties.statusCode.const).toBe(413)
  expect(components.schemas.Error413.properties.name.enum).toEqual([
    "validation_error",
  ])
  for (const { method, path } of registrations) {
    const response = source.paths[path][method.toLowerCase()].responses["413"]
    // Fetch Request objects cannot carry a GET body. The shared wrapper bounds
    // every POST/PATCH/DELETE body, including unexpected bodies on delete routes.
    if (method === "GET") expect(response, `${method} ${path}`).toBeUndefined()
    else
      expect(response, `${method} ${path}`).toEqual({
        $ref: "#/components/responses/Error413",
      })
  }
})

test("enriched operations have descriptions, scopes, schemas and valid examples without changing wire fields", async () => {
  await SwaggerParser.validate(
    structuredClone(document) as unknown as Parameters<
      typeof SwaggerParser.validate
    >[0],
    { resolve: { http: false } }
  )
  const ajv = new Ajv2020({
    strict: false,
    allErrors: true,
    validateFormats: false,
  })
  ajv.addSchema(
    { ...document, $id: "https://example.test/openapi" },
    "contract"
  )
  const errors: string[] = []
  const validators = new Map<string, ReturnType<typeof ajv.compile>>()
  const mediaCheck = (container: Record<string, unknown>, context: string) => {
    const content = container.content as Record<
      string,
      {
        schema: AnySchema
        example?: unknown
        examples?: Record<string, { value: unknown }>
      }
    >
    expect(content, context).toBeDefined()
    for (const media of Object.values(content)) {
      const key = JSON.stringify(media.schema)
      let validate = validators.get(key)
      if (!validate) {
        // Local refs refer to the original document's components. No fields are added.
        validate = ajv.compile({
          ...(media.schema as Record<string, unknown>),
          components: document.components,
        })
        validators.set(key, validate)
      }
      const examples = media.examples
        ? Object.values(media.examples).map((item) => item.value)
        : [media.example]
      expect(examples.length, context).toBeGreaterThan(0)
      for (const value of examples) {
        expect(value, context).not.toBeUndefined()
        if (value && typeof value === "object" && "statusCode" in value)
          expect(value.statusCode, context).toBe(
            Number(context.split(" ").at(-1))
          )
        if (!validate(value)) {
          // Credential examples are redacted, rather than publishing API-key-shaped strings.
          const failures = validate.errors?.filter(
            (error) =>
              !(
                error.keyword === "pattern" &&
                error.instancePath === "/token" &&
                error.params.pattern.startsWith("^os_") &&
                (value as Record<string, unknown>).token ===
                  "credential-placeholder"
              )
          )
          if (failures?.length)
            errors.push(context + " " + JSON.stringify(failures))
        }
      }
    }
  }
  for (const [path, methods] of Object.entries(document.paths))
    for (const [method, operation] of Object.entries(methods)) {
      const context = `${method.toUpperCase()} ${path}`
      expect(operation.summary, context).toBeTruthy()
      expect(operation.description, context).toBeTruthy()
      expect(operation["x-opensend-scope"], context).toBe(
        source.paths[path][method]["x-opensend-scope"]
      )
      if (operation.requestBody)
        mediaCheck(operation.requestBody, context + " request")
      for (const [status, response] of Object.entries(operation.responses))
        mediaCheck(response, context + " " + status)
    }
  expect(errors).toEqual([])
  expect((document.components as { schemas: unknown }).schemas).toEqual(
    (source.components as { schemas: unknown }).schemas
  )
  expect(source.paths["/knowledge-bases"].get.description).toBeUndefined()
  expect(document.paths["/knowledge-bases"].get.description).toBeTruthy()
})
