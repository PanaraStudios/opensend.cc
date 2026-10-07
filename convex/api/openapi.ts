/** Documentation enrichment only: REST handlers and wire schemas are unchanged.
 * Pass the parsed openapi/opensend.yaml document to buildOpenApi before export.
 */
import {
  API_SCOPES,
  scopeDescription,
  type ApiScope,
} from "../../lib/api-scopes"
type ObjectValue = Record<string, unknown>
export type OpenApiDocument = ObjectValue & {
  paths: Record<string, Record<string, OpenApiOperation>>
}
export type OpenApiOperation = ObjectValue & {
  summary: string
  description?: string
  "x-opensend-scope": string
  parameters?: ObjectValue[]
  requestBody?: ObjectValue
  responses: Record<string, ObjectValue>
}
const isObject = (value: unknown): value is ObjectValue =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** Resolve only local references; the export never requires a network request. */
function resolve(document: OpenApiDocument, value: ObjectValue): ObjectValue {
  if (typeof value.$ref !== "string") return value
  if (!value.$ref.startsWith("#/"))
    throw new Error(`External OpenAPI reference: ${value.$ref}`)
  let target: unknown = document
  for (const segment of value.$ref.slice(2).split("/")) {
    if (!isObject(target)) throw new Error(`Invalid reference: ${value.$ref}`)
    target = target[segment.replace(/~1/g, "/").replace(/~0/g, "~")]
  }
  if (!isObject(target)) throw new Error(`Missing reference: ${value.$ref}`)
  return {
    ...target,
    ...Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== "$ref")
    ),
  }
}
function merge(left: unknown, right: unknown): unknown {
  if (!isObject(left) || !isObject(right)) return right
  const result = { ...left }
  for (const [key, value] of Object.entries(right))
    result[key] = key in result ? merge(result[key], value) : value
  return result
}

/** Examples use declared properties only, including required nested fields.
 * The contract test validates each generated example against its wire schema.
 */
function example(
  document: OpenApiDocument,
  input: ObjectValue,
  key = "",
  depth = 0
): unknown {
  let schema = resolve(document, input)
  if (Array.isArray(schema.allOf)) {
    const { allOf, ...base } = schema
    schema = base
    for (const branch of allOf)
      if (isObject(branch)) {
        const resolved = resolve(document, branch)
        const required = [
          ...new Set([
            ...(Array.isArray(schema.required) ? schema.required : []),
            ...(Array.isArray(resolved.required) ? resolved.required : []),
          ]),
        ]
        schema = merge(schema, resolved) as ObjectValue
        if (required.length) schema.required = required
      }
  }
  if (schema.example !== undefined) return schema.example
  if (Array.isArray(schema.examples) && schema.examples.length)
    return schema.examples[0]
  if (schema.default !== undefined) return schema.default
  if (schema.const !== undefined) return schema.const
  if (Array.isArray(schema.enum)) return schema.enum[0]
  if (depth > 12) return null
  const sample = (node: ObjectValue, name = key) =>
    example(document, node, name, depth + 1)
  const branchSample = (branch: ObjectValue) => {
    const resolved = resolve(document, branch)
    return sample(
      isObject(schema.properties) && (resolved.properties || resolved.required)
        ? {
            ...resolved,
            properties: merge(schema.properties, resolved.properties ?? {}),
            required: [
              ...new Set([
                ...(Array.isArray(schema.required) ? schema.required : []),
                ...(Array.isArray(resolved.required) ? resolved.required : []),
              ]),
            ],
          }
        : resolved
    )
  }
  const type = Array.isArray(schema.type)
    ? schema.type.find((t) => t !== "null")
    : schema.type
  let value: unknown
  if (type === "object" || schema.properties) {
    const properties = isObject(schema.properties) ? schema.properties : {}
    const required = Array.isArray(schema.required) ? schema.required : []
    value = Object.fromEntries(
      required.map((name) => {
        if (typeof name !== "string" || !isObject(properties[name]))
          throw new Error(`Undocumented required field: ${String(name)}`)
        return [name, sample(properties[name], name)]
      })
    )
  } else if (type === "array") {
    const count = typeof schema.minItems === "number" ? schema.minItems : 1
    value = Array.from({ length: count }, () =>
      isObject(schema.items) ? sample(schema.items) : "example"
    )
  } else if (type === "number" || type === "integer") {
    value =
      typeof schema.minimum === "number"
        ? schema.minimum
        : typeof schema.exclusiveMinimum === "number"
          ? schema.exclusiveMinimum + 1
          : 1
  } else if (type === "boolean") value = true
  else if (type === "null") value = null
  else if (type === "string") {
    if (schema.format === "date-time") value = "2030-01-01T00:00:00Z"
    else if (schema.format === "date") value = "2030-01-01"
    else if (
      schema.format === "email" ||
      /^(email|from|to|reply_to)$/.test(key)
    )
      value = "person@example.test"
    else if (schema.format === "uri" || /url|endpoint/i.test(key))
      value = "https://example.test/resource"
    else if (schema.format === "uuid")
      value = "00000000-0000-4000-8000-000000000000"
    else if (/scheduled_at|created_at|updated_at/.test(key))
      value = "2030-01-01T00:00:00Z"
    else if (/content|base64/.test(key)) value = "SGVsbG8="
    else if (/key|secret|token/i.test(key)) value = "credential-placeholder"
    else value = "example"
    if (
      typeof schema.minLength === "number" &&
      String(value).length < schema.minLength
    )
      value = String(value).padEnd(schema.minLength, "x")
    if (
      typeof schema.pattern === "string" &&
      !new RegExp(schema.pattern).test(String(value))
    ) {
      const pattern = new RegExp(schema.pattern)
      if (schema.pattern.startsWith("^os_") && /token|key|secret/i.test(key))
        return "credential-placeholder"
      const candidate = [
        "example",
        "example_value",
        "16505551234",
        "0123456789abcdef",
        "mail.example.test",
        "SGVsbG8=",
      ].find((value) => pattern.test(value))
      if (candidate === undefined)
        throw new Error(
          `Schema needs an explicit example for pattern: ${schema.pattern}`
        )
      value = candidate
    }
    if (typeof schema.maxLength === "number")
      value = String(value).slice(0, schema.maxLength)
  }
  if (Array.isArray(schema.allOf))
    for (const branch of schema.allOf)
      if (isObject(branch))
        value =
          value === undefined
            ? branchSample(branch)
            : merge(value, branchSample(branch))
  for (const alternatives of [schema.oneOf, schema.anyOf]) {
    const branches = Array.isArray(alternatives)
      ? alternatives.filter(isObject).filter((branch) => {
          const branchType = resolve(document, branch).type
          return (
            type === undefined ||
            branchType === undefined ||
            branchType === type ||
            (Array.isArray(branchType) && branchType.includes(type))
          )
        })
      : []
    if (branches.length)
      value =
        value === undefined
          ? branchSample(branches[0])
          : merge(value, branchSample(branches[0]))
  }
  if (isObject(schema.if) && isObject(value)) {
    const condition = schema.if
    const present = (
      Array.isArray(condition.required) ? condition.required : []
    ).every((name) => typeof name === "string" && name in value)
    const matches = Object.entries(
      isObject(condition.properties) ? condition.properties : {}
    ).every(([name, constraint]) => {
      if (!(name in value) || !isObject(constraint)) return true
      return (
        (constraint.const === undefined || value[name] === constraint.const) &&
        (!Array.isArray(constraint.enum) ||
          constraint.enum.includes(value[name]))
      )
    })
    const { if: ignored, then, else: otherwise, ...base } = schema
    void ignored
    const branch = present && matches ? then : otherwise
    if (isObject(branch)) {
      const combined = merge(base, branch) as ObjectValue
      combined.required = [
        ...new Set([
          ...(Array.isArray(base.required) ? base.required : []),
          ...(Array.isArray(branch.required) ? branch.required : []),
        ]),
      ]
      return example(document, combined, key, depth + 1)
    }
  }
  return value === undefined ? {} : value
}
function contentExamples(
  document: OpenApiDocument,
  container: ObjectValue,
  status?: string
): void {
  if (!isObject(container.content)) return
  // Response references may be reused for several statuses. Keep each example local.
  const content = structuredClone(container.content)
  container.content = content
  for (const media of Object.values(content)) {
    if (!isObject(media) || !isObject(media.schema))
      throw new Error("OpenAPI media type requires a schema")
    if (media.example !== undefined || media.examples !== undefined) continue
    const value = example(document, media.schema)
    if (isObject(value) && "statusCode" in value && status) {
      value.statusCode = Number(status)
      const names: Record<string, string> = {
        "400": "validation_error",
        "401": "missing_api_key",
        "403": "restricted_api_key",
        "404": "not_found",
        "409": "invalid_idempotent_request",
        "413": "validation_error",
        "422": "validation_error",
        "429": "rate_limit_exceeded",
        "500": "application_error",
        "502": "meta_api_error",
        "503": "application_error",
      }
      const schema = resolve(document, media.schema)
      const properties = isObject(schema.properties) ? schema.properties : {}
      const name = isObject(properties.name) ? properties.name : {}
      if (
        "name" in value &&
        names[status] &&
        name.const === undefined &&
        (!Array.isArray(name.enum) || name.enum.includes(names[status]))
      )
        value.name = names[status]
    }
    media.example = value
  }
}
export function buildOpenApi(source: OpenApiDocument): OpenApiDocument {
  const document = structuredClone(source)
  for (const [path, methods] of Object.entries(document.paths))
    for (const [method, operation] of Object.entries(methods)) {
      if (!["get", "post", "patch", "delete", "put"].includes(method)) continue
      if (!operation.summary || !operation["x-opensend-scope"])
        throw new Error(
          "Every REST operation requires a summary and x-opensend-scope"
        )
      const scope = operation["x-opensend-scope"]
      if (scope !== "full_access" && !API_SCOPES.includes(scope as ApiScope))
        throw new Error(`Unknown OpenAPI scope: ${scope}`)
      operation.description ||= `${operation.summary}. Responses use the documented resource schema; failures return statusCode, name and message.`
      // Full-access fallbacks on unified message routes have dynamic scopes,
      // described by their authored text. Static resource scopes use the catalog.
      const dynamicScope =
        scope === "full_access" &&
        (path === "/messages" || path === "/messages/{id}")
      if (!dynamicScope) {
        const permission = scopeDescription(scope as ApiScope | "full_access")
        if (!operation.description.includes(permission))
          operation.description += ` ${permission}`
      }
      operation.parameters = operation.parameters?.map((input) => {
        const parameter = resolve(document, input)
        if (
          isObject(parameter.schema) &&
          parameter.example === undefined &&
          parameter.examples === undefined
        )
          parameter.example = example(
            document,
            parameter.schema,
            String(parameter.name)
          )
        return parameter
      })
      if (operation.requestBody) {
        operation.requestBody = resolve(document, operation.requestBody)
        contentExamples(document, operation.requestBody)
      }
      operation.responses = Object.fromEntries(
        Object.entries(operation.responses).map(([status, input]) => {
          const response = resolve(document, input)
          contentExamples(document, response, status)
          return [status, response]
        })
      )
    }
  return document
}
