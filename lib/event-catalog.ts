import {
  CONTACT_SCHEMA,
  SYSTEM_EVENT_CATALOG,
  field,
  object,
  type CatalogEvent,
  type EventField,
} from "../packages/sdk/src/events/catalog"
export {
  CONTACT_SCHEMA,
  SYSTEM_EVENT_CATALOG,
} from "../packages/sdk/src/events/catalog"
export type {
  CatalogEvent,
  EventField,
} from "../packages/sdk/src/events/catalog"

export type CustomEventDefinition = {
  name: string
  schema: { key: string; type: "string" | "number" | "boolean" | "date" }[]
}
export function eventCatalog(
  custom: readonly CustomEventDefinition[] = [],
  properties: readonly { key: string }[] = []
): CatalogEvent[] {
  const contact = object(
    {
      ...CONTACT_SCHEMA.fields,
      properties: object(
        Object.fromEntries(
          properties.map((p) => [
            p.key,
            field("string", `Contact property ${p.key}`, "example", {
              optional: true,
            }),
          ])
        )
      ),
    },
    "Contact"
  )
  return [
    ...SYSTEM_EVENT_CATALOG.map((event) => ({
      ...event,
      schema: {
        ...event.schema,
        fields: {
          ...event.schema.fields,
          ...(event.schema.fields?.properties
            ? { properties: contact.fields!.properties }
            : {}),
          ...(event.schema.fields?.contact ? { contact } : {}),
        },
      },
    })),
    ...custom.map((event) => ({
      name: event.name,
      trigger: event.name,
      label: event.name,
      group: "Custom events",
      description: "An event sent by your application.",
      schema: object(
        Object.fromEntries(
          event.schema.map((p) => [
            p.key,
            field(
              p.type,
              p.key,
              p.type === "number"
                ? 1
                : p.type === "boolean"
                  ? true
                  : p.type === "date"
                    ? "2026-10-02T12:00:00.000Z"
                    : "example"
            ),
          ])
        )
      ),
    })),
  ]
}
export function catalogEvent(
  catalog: readonly CatalogEvent[],
  trigger: string
) {
  return catalog.find((event) => event.trigger === trigger)
}

/** Display names come from the catalog; stored triggers and wire names stay intact. */
export function eventLabel(
  value: string,
  key: "trigger" | "name" = "trigger"
): string {
  return (
    SYSTEM_EVENT_CATALOG.find((event) => event[key] === value)?.label ??
    (value || "Custom event")
  )
}
export function schemaField(
  schema: EventField | undefined,
  path: string
): EventField | undefined {
  return path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .reduce<EventField | undefined>(
      (value, key) =>
        value?.items && /^\d+$/.test(key)
          ? value.items
          : (value?.fields?.[key] ??
            value?.additionalProperties ??
            (value?.dynamic ? value : undefined)),
      schema
    )
}
export function flattenSchema(
  schema: EventField,
  prefix = ""
): { path: string; field: EventField }[] {
  const own = prefix ? [{ path: prefix, field: schema }] : []
  const items = schema.items ? flattenSchema(schema.items, `${prefix}.0`) : []
  return [
    ...own,
    ...items,
    ...Object.entries(schema.fields ?? {}).flatMap(([key, value]) =>
      flattenSchema(value, prefix ? `${prefix}.${key}` : key)
    ),
  ]
}

export function catalogContactSchema(
  catalog: readonly CatalogEvent[]
): EventField {
  return (
    catalog.find((event) => event.schema.fields?.contact)?.schema.fields
      ?.contact ?? CONTACT_SCHEMA
  )
}
