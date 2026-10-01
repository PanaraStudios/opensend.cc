"use client"

import * as React from "react"
import { api } from "@/convex/_generated/api"
import { useTeamQuery } from "@/components/auth/workspace"
import { OptionSelect, SettingsCard } from "@/components/dashboard/primitives"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { WhatsAppTemplatePreview } from "@/components/dashboard/templates/whatsapp-preview"
import { formFromComponents, storedComponents } from "@/lib/meta/templates"
import {
  resolveVariables,
  type VariableContact,
  type VariableSource,
} from "@/lib/meta/variables"

const VARIABLE_SOURCES = [
  { value: "contact", label: "Contact field" },
  { value: "property", label: "Property" },
  { value: "value", label: "Static value" },
] as const

export type WhatsAppCampaignConfig = {
  accountId: string
  templateId?: string
  mode?: "template" | "text"
  variables: Record<string, VariableSource>
  text?: string
}
const CONTACT_FIELDS = [
  { value: "firstName", label: "First name" },
  { value: "lastName", label: "Last name" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
] as const

function VariableMapping({
  name,
  value,
  onChange,
}: {
  name: string
  value: VariableSource
  onChange: (source: VariableSource) => void
}) {
  const source = typeof value === "string" ? { value } : value
  const kind =
    "contact" in source
      ? "contact"
      : "property" in source
        ? "property"
        : "value"
  const [propertySearch, setPropertySearch] = React.useState("")
  const properties =
    useTeamQuery(api.contactProperties.options, { search: propertySearch }) ??
    []
  return (
    <FieldGroup>
      <Field>
        <FieldLabel>Variable {`{{${name}}}`}</FieldLabel>
        <OptionSelect
          aria-label={`Source for {{${name}}}`}
          value={kind}
          items={VARIABLE_SOURCES}
          onChange={(next) =>
            onChange({
              ...(next === "contact"
                ? { contact: "firstName" as const }
                : next === "property"
                  ? { property: "" }
                  : { value: "" }),
              fallback: source.fallback ?? "",
            })
          }
        />
        {"contact" in source ? (
          <OptionSelect
            aria-label={`Contact field for {{${name}}}`}
            value={source.contact}
            items={CONTACT_FIELDS}
            onChange={(contact) =>
              onChange({
                contact: contact as typeof source.contact,
                fallback: source.fallback,
              })
            }
          />
        ) : "property" in source ? (
          <OptionSelect
            aria-label={`Property for {{${name}}}`}
            value={source.property}
            placeholder="Select property"
            search={{ onChange: setPropertySearch }}
            items={properties.map((property) => ({
              value: property.key,
              label: property.key,
            }))}
            selectedItem={
              source.property
                ? { value: source.property, label: source.property }
                : undefined
            }
            onChange={(property) =>
              onChange({ property, fallback: source.fallback })
            }
          />
        ) : (
          <Input
            aria-label={`Value for {{${name}}}`}
            value={source.value}
            onChange={(event) =>
              onChange({ value: event.target.value, fallback: source.fallback })
            }
          />
        )}
        <Input
          aria-label={`Fallback for {{${name}}}`}
          placeholder="Fallback"
          value={source.fallback ?? ""}
          onChange={(event) =>
            onChange({ ...source, fallback: event.target.value })
          }
        />
        <FieldDescription>Used when the contact has no value.</FieldDescription>
      </Field>
    </FieldGroup>
  )
}

/** Shared sending-number/template controls and mappings for broadcasts and steps. */
export function WhatsAppCampaignFields({
  config,
  onChange,
  sample,
  allowText = false,
}: {
  config: WhatsAppCampaignConfig
  onChange: (config: WhatsAppCampaignConfig) => void
  sample?: VariableContact | null
  allowText?: boolean
}) {
  const [accountSearch, setAccountSearch] = React.useState("")
  const [templateSearch, setTemplateSearch] = React.useState("")
  const options = useTeamQuery(api.broadcastWhatsApp.options, {
    accountId: config.accountId,
    templateId: config.templateId,
    accountSearch,
    templateSearch,
  })
  const selected = options?.selected
  const components = storedComponents(selected?.components)
  const values = resolveVariables(
    config.variables,
    sample ?? {
      firstName: "Alex",
      lastName: "Taylor",
      email: "alex@example.com",
      phone: "+15551234567",
      properties: {},
    }
  )
  return (
    <FieldGroup>
      <Field>
        <FieldLabel>Sending number</FieldLabel>
        <OptionSelect
          aria-label="Sending number"
          value={config.accountId}
          placeholder="Select a WhatsApp number"
          search={{ onChange: setAccountSearch }}
          items={(options?.accounts ?? []).map((account) => ({
            value: account.id,
            label: account.name,
          }))}
          onChange={(accountId) =>
            onChange({ ...config, accountId, templateId: "", variables: {} })
          }
        />
      </Field>
      {allowText ? (
        <Field>
          <FieldLabel>Message type</FieldLabel>
          <OptionSelect
            aria-label="Message type"
            value={config.mode ?? "template"}
            items={[
              { value: "template", label: "Template" },
              { value: "text", label: "Text" },
            ]}
            onChange={(mode) =>
              onChange({ ...config, mode: mode as "template" | "text" })
            }
          />
        </Field>
      ) : null}
      {config.mode === "text" ? (
        <Field>
          <FieldLabel>Message</FieldLabel>
          <Textarea
            aria-label="WhatsApp message"
            value={config.text ?? ""}
            onChange={(event) =>
              onChange({ ...config, text: event.target.value })
            }
          />
          <FieldDescription>
            Text is skipped when the 24-hour service window is closed.
          </FieldDescription>
        </Field>
      ) : (
        <>
          <Field>
            <FieldLabel>Approved template</FieldLabel>
            <OptionSelect
              aria-label="Approved template"
              value={config.templateId ?? ""}
              disabled={!config.accountId}
              placeholder="Select an approved template"
              search={{ onChange: setTemplateSearch }}
              items={(options?.templates ?? []).map((template) => ({
                value: template.id,
                label: template.name,
              }))}
              onChange={(templateId) =>
                onChange({ ...config, templateId, variables: {} })
              }
            />
          </Field>
          {(selected?.variables ?? []).map((name) => (
            <VariableMapping
              key={name}
              name={name}
              value={config.variables[name] ?? { value: "" }}
              onChange={(source) =>
                onChange({
                  ...config,
                  variables: {
                    ...Object.fromEntries(
                      (selected?.variables ?? []).map((key) => [
                        key,
                        config.variables[key] ?? { value: "" },
                      ])
                    ),
                    [name]: source,
                  },
                })
              }
            />
          ))}
          {selected ? (
            <SettingsCard title="Preview" description="Sample contact values">
              <div data-testid="whatsapp-campaign-preview">
                <WhatsAppTemplatePreview
                  form={{
                    ...formFromComponents(components).form,
                    examples: values,
                  }}
                />
              </div>
            </SettingsCard>
          ) : null}
        </>
      )}
    </FieldGroup>
  )
}
