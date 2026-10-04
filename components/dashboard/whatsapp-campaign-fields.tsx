"use client"
import { FileUploadField } from "./file-upload"

import * as React from "react"
import { CHANNELS, type MessagingChannel } from "@/lib/channels"
import { api } from "@/convex/_generated/api"
import { useTeamQuery } from "@/components/auth/workspace"
import { OptionSelect } from "@/components/dashboard/primitives"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldSet,
  FieldLegend,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { WhatsAppTemplatePreview } from "@/components/dashboard/templates/whatsapp-preview"
import {
  formFromComponents,
  storedComponents,
  renderedTemplateFromForm,
  templateMediaHeader,
} from "@/lib/meta/templates"
import {
  CONTACT_VARIABLE_FIELDS,
  normalizeVariableSource,
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

function VariableMapping({
  name,
  value,
  onChange,
  renderValueField,
}: {
  renderValueField?: (props: {
    name: string
    value: VariableSource
    onChange: (value: VariableSource) => void
  }) => React.ReactNode
  name: string
  value: VariableSource
  onChange: (source: VariableSource) => void
}) {
  const source = normalizeVariableSource(value)
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
            items={CONTACT_VARIABLE_FIELDS}
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
        ) : renderValueField ? (
          renderValueField({ name, value: source, onChange })
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

/** Shared account/template controls and mappings for broadcasts and channel steps. */
export function WhatsAppCampaignFields({
  config,
  onChange,
  sample,
  allowText = false,
  channel = "whatsapp",
  renderTextField,
  renderVariableField,
}: {
  config: WhatsAppCampaignConfig
  onChange: (config: WhatsAppCampaignConfig) => void
  sample?: VariableContact | null
  allowText?: boolean
  channel?: MessagingChannel
  renderTextField?: (props: {
    value: string
    onChange: (value: string) => void
    "aria-label": string
  }) => React.ReactNode
  renderVariableField?: (props: {
    name: string
    value: VariableSource
    onChange: (value: VariableSource) => void
  }) => React.ReactNode
}) {
  const [accountSearch, setAccountSearch] = React.useState("")
  const [templateSearch, setTemplateSearch] = React.useState("")
  const pickerArgs = {
    accountId: config.accountId,
    templateId: config.templateId,
    accountSearch,
    templateSearch,
  }
  const whatsappOptions = useTeamQuery(
    api.broadcastWhatsApp.options,
    pickerArgs,
    { enabled: channel === "whatsapp" }
  )
  const pageOptions = useTeamQuery(
    api.automations.channelOptions,
    {
      ...pickerArgs,
      channel: channel === "instagram" ? "instagram" : "messenger",
    },
    { enabled: channel !== "whatsapp" }
  )
  const options = channel === "whatsapp" ? whatsappOptions : pageOptions
  const accountLabel = "Sender"
  const templateLabel =
    channel === "whatsapp" ? "Approved template" : "Published template"
  const selected = options?.selected
  const components = storedComponents(selected?.components)
  const header = templateMediaHeader(components)
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
        <FieldLabel>{accountLabel}</FieldLabel>
        <OptionSelect
          aria-label={accountLabel}
          value={config.accountId}
          placeholder={`Select a ${CHANNELS[channel].label} ${CHANNELS[channel].accountNoun.toLowerCase()}`}
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
          {renderTextField ? (
            renderTextField({
              value: config.text ?? "",
              onChange: (text) => onChange({ ...config, text }),
              "aria-label": `${CHANNELS[channel].label} message`,
            })
          ) : (
            <Textarea
              aria-label={`${CHANNELS[channel].label} message`}
              value={config.text ?? ""}
              onChange={(event) =>
                onChange({ ...config, text: event.target.value })
              }
            />
          )}
          <FieldDescription>
            Text is skipped when the 24-hour service window is closed.
          </FieldDescription>
        </Field>
      ) : (
        <>
          <Field>
            <FieldLabel>{templateLabel}</FieldLabel>
            <OptionSelect
              aria-label={templateLabel}
              value={config.templateId ?? ""}
              disabled={!config.accountId}
              placeholder={
                channel === "whatsapp"
                  ? "Select an approved template"
                  : "Select a published template"
              }
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
          {channel === "whatsapp" && header ? (
            <FileUploadField
              key={`${config.accountId}:${config.templateId}`}
              label={`Header ${header.format.toLowerCase()}`}
              use="whatsapp"
              required={!header.sampleFileId}
              accept={
                header.format === "IMAGE"
                  ? "image/jpeg,image/png"
                  : header.format === "VIDEO"
                    ? "video/mp4,video/3gpp"
                    : undefined
              }
              from={config.accountId}
              disabled={!config.accountId}
              onRemoved={() => {
                const variables = { ...config.variables }
                delete variables.header_media
                onChange({ ...config, variables })
              }}
              onUploaded={(id) =>
                onChange({
                  ...config,
                  variables: {
                    ...config.variables,
                    header_media: { value: `opensend-file:${id}` },
                  },
                })
              }
            />
          ) : null}
          {(selected?.variables ?? [])
            .filter((name) => name !== "header_media")
            .map((name) => (
              <VariableMapping
                key={name}
                name={name}
                value={config.variables[name] ?? { value: "" }}
                renderValueField={renderVariableField}
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
          {selected && channel === "whatsapp" ? (
            <FieldSet>
              <FieldLegend variant="label">Preview</FieldLegend>
              <FieldDescription>Sample contact values</FieldDescription>
              <div data-testid="whatsapp-campaign-preview">
                <WhatsAppTemplatePreview
                  rendered={renderedTemplateFromForm({
                    ...formFromComponents(components).form,
                    examples: values,
                  })}
                />
              </div>
            </FieldSet>
          ) : null}
        </>
      )}
    </FieldGroup>
  )
}
