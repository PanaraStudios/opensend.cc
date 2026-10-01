"use client"
import * as React from "react"
import {
  CopyIcon,
  ExternalLinkIcon,
  ListIcon,
  MapPinIcon,
  PhoneIcon,
  ReplyIcon,
  ShoppingBagIcon,
  type LucideIcon,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { WhatsAppTemplatePreview } from "@/components/dashboard/templates/whatsapp-preview"
import { object, array, string } from "@/lib/meta/parse"
import { safeMessageUrl } from "@/lib/dashboard/conversation-content"
import type { ThreadMessage } from "@/lib/messages/use-messages"
import { ConversationImage, ConversationMedia } from "./media"
import { FormattedText } from "./formatted-text"

function componentsFromContent(content: Record<string, unknown>, type: string) {
  return array(content.components)
    .map(object)
    .find((component) => component.type === type)
}

type CardButton = { type: string; text: string; url?: string; code?: string }
const ICONS: Record<string, LucideIcon> = {
  URL: ExternalLinkIcon,
  CTA_URL: ExternalLinkIcon,
  PHONE_NUMBER: PhoneIcon,
  VOICE_CALL: PhoneIcon,
  OTP: CopyIcon,
  COPY_CODE: CopyIcon,
  LIST: ListIcon,
  CATALOG: ShoppingBagIcon,
}
export function AttachedButtons({ buttons }: { buttons: CardButton[] }) {
  const [expanded, setExpanded] = React.useState(false)
  const visible =
    !expanded && buttons.length > 3 ? buttons.slice(0, 2) : buttons
  return (
    <div className="chat-buttons">
      {visible.map((button, index) => {
        const Icon = ICONS[button.type.toUpperCase()] ?? ReplyIcon
        const href = safeMessageUrl(button.url, true)
        if (href)
          return (
            <a
              key={index}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon className="size-4 shrink-0" />
              {button.text}
            </a>
          )
        if (button.code)
          return (
            <button
              key={index}
              type="button"
              onClick={() =>
                void navigator.clipboard
                  .writeText(button.code!)
                  .catch(() => undefined)
              }
            >
              <Icon className="size-4 shrink-0" />
              {button.text}
            </button>
          )
        return (
          <div
            key={index}
            className="chat-button"
            aria-label={`${button.text} (message preview)`}
          >
            <Icon className="size-4 shrink-0" />
            {button.text}
          </div>
        )
      })}
      {!expanded && buttons.length > 3 ? (
        <button type="button" onClick={() => setExpanded(true)}>
          See all options
        </button>
      ) : null}
    </div>
  )
}
function ListOptions({ action }: { action: Record<string, unknown> }) {
  return (
    <Sheet>
      <SheetTrigger className="chat-button w-full">
        <ListIcon className="size-4 shrink-0" />
        {string(action.button) || "View options"}
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{string(action.button) || "Options"}</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-4 overflow-y-auto p-4">
          {array(action.sections).map((raw, i) => {
            const section = object(raw)
            return (
              <section key={i}>
                <h3 className="font-medium">{string(section.title)}</h3>
                {array(section.rows).map((row, j) => (
                  <div key={j} className="border-b border-border py-3">
                    <p>{string(object(row).title)}</p>
                    <p className="text-xs text-muted-foreground">
                      {string(object(row).description)}
                    </p>
                  </div>
                ))}
              </section>
            )
          })}
        </div>
      </SheetContent>
    </Sheet>
  )
}
function ProductRows({ rows }: { rows: unknown[] }) {
  return (
    <div className="flex flex-col gap-2">
      {rows.map((raw, index) => {
        const item = object(raw)
        const amount = object(item.amount)
        return (
          <div key={index} className="flex items-center gap-2">
            <ShoppingBagIcon className="size-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p>
                {string(item.name) ||
                  string(item.product_retailer_id) ||
                  string(item.retailer_id) ||
                  "Product"}
              </p>
              <p className="text-xs opacity-70">
                {item.quantity ? `${item.quantity} × ` : ""}
                {(typeof item.item_price === "number"
                  ? String(item.item_price)
                  : string(item.item_price)) ||
                  (typeof amount.value === "number"
                    ? String(amount.value / Number(amount.offset || 100))
                    : "")}
                {string(item.currency) ? ` ${item.currency}` : ""}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
export function BusinessCard({
  message,
  content: supplied,
  fileIndex = 0,
  rendered: suppliedRendered,
}: {
  message: ThreadMessage
  content?: Record<string, unknown>
  fileIndex?: number
  rendered?: ThreadMessage["rendered"]
}) {
  const data = message.normalized
  const content = supplied ?? object(data?.content)
  const header = object(content.header)
  const body = object(content.body)
  const action = object(content.action)
  const parameters = object(action.parameters)
  const footer = object(content.footer)
  const kind = string(content.type)
  const rendered = suppliedRendered ?? (supplied ? undefined : message.rendered)
  const headerParameter = object(
    array(componentsFromContent(content, "header")?.parameters)[0]
  )
  const headerType =
    string(header.type) ||
    rendered?.header?.format.toLowerCase() ||
    (["image", "video", "document", "location", "product"].includes(
      string(headerParameter.type)
    )
      ? string(headerParameter.type)
      : undefined)
  const locationHeader =
    headerType === "location"
      ? object(
          array(object(componentsFromContent(content, "header")).parameters)[0]
        ).location
      : undefined
  const buttons: CardButton[] =
    rendered?.buttons.map((button) => ({ ...button })) ?? []
  if (!buttons.length && data?.type === "template") {
    const labels: Record<string, string> = {
      quick_reply: "Reply",
      url: "Open link",
      copy_code: "Copy code",
      flow: "Open form",
      catalog: "View catalog",
      mpm: "View products",
      spm: "View product",
      voice_call: "Voice call",
      order_details: "Review and pay",
    }
    for (const component of array(content.components).map(object)) {
      if (component.type !== "button") continue
      const kind = string(component.sub_type).toLowerCase()
      const parameter = object(array(component.parameters)[0])
      buttons.push({
        type: kind.toUpperCase(),
        text: labels[kind] || "Open",
        ...(parameter.coupon_code
          ? { code: string(parameter.coupon_code) }
          : {}),
      })
    }
  }
  for (const raw of array(action.buttons)) {
    const button = object(raw)
    const reply = object(button.reply)
    buttons.push({
      type: string(button.type),
      text: string(reply.title) || string(button.title) || "Reply",
    })
  }
  if (kind === "cta_url")
    buttons.push({
      type: "URL",
      text: string(parameters.display_text) || "Open link",
      url: string(parameters.url),
    })
  const cta = object(action.cta_url)
  if (cta.url)
    buttons.push({
      type: "URL",
      text: string(cta.display_text) || "Open link",
      url: string(cta.url),
    })
  const labels: Record<string, string> = {
    flow: "Open form",
    location_request_message: "Send location",
    address_message: "Provide address",
    product: "View product",
    product_list: "View products",
    catalog_message: "View catalog",
    order_details: "Review and pay",
    order_status: "Review order",
    request_contact_info: "Share contact",
    voice_call: "Voice call",
    call_permission_request: "Allow calls",
  }
  if (labels[kind])
    buttons.push({
      type: kind === "catalog_message" ? "CATALOG" : "QUICK_REPLY",
      text:
        string(parameters.flow_cta) ||
        string(parameters.display_text) ||
        labels[kind],
    })
  const templateOrder = object(
    array(componentsFromContent(content, "order_status")?.parameters)[0]
  ).order_status
  const paymentButton = array(content.components)
    .map(object)
    .find((component) => component.sub_type === "order_details")
  const payment = object(
    object(object(array(paymentButton?.parameters)[0]).action).order_details
  )
  const commerce = Object.keys(parameters).length
    ? parameters
    : Object.keys(payment).length
      ? payment
      : object(templateOrder)
  const order = object(commerce.order)
  const products = array(order.items).length
    ? array(order.items)
    : array(content.product_items).length
      ? array(content.product_items)
      : array(action.sections).flatMap((section) =>
          array(object(section).product_items)
        )
  const cards = array(action.cards)
  const elements = array(content.elements)
  const components = array(content.components)
  const carousel = components.find(
    (component) => object(component).type === "carousel"
  )
  const templateCards = array(object(carousel).cards)
  return (
    <div className="chat-business-card">
      {elements.length ? (
        <div className="chat-carousel" aria-label="Generic cards">
          {elements.map((raw, index) => (
            <div key={index}>
              <GenericCard content={object(raw)} />
            </div>
          ))}
        </div>
      ) : null}
      {content.template_type === "button" ? (
        <GenericCard content={content} />
      ) : null}
      {headerType && headerType !== "text" ? (
        headerType === "product" ? (
          <ProductRows
            rows={[
              object(
                object(
                  array(componentsFromContent(content, "header")?.parameters)[0]
                ).product
              ),
            ]}
          />
        ) : headerType === "location" ? (
          <LocationCard location={object(locationHeader || header.location)} />
        ) : (
          <ConversationMedia
            file={data?.attachments[fileIndex]}
            type={headerType}
          />
        )
      ) : null}
      {rendered && !elements.length && content.template_type !== "button" ? (
        <WhatsAppTemplatePreview
          rendered={{ ...rendered, cards: undefined }}
          embedded
          showButtons={false}
          showHeader={headerType === "text"}
        />
      ) : !elements.length && content.template_type !== "button" ? (
        <>
          {header.text ? (
            <p className="font-semibold">
              <FormattedText text={string(header.text)} />
            </p>
          ) : null}
          <p>
            <FormattedText
              text={
                string(body.text) ||
                string(content.text) ||
                (supplied ? "" : message.text)
              }
            />
          </p>
          {footer.text ? (
            <p className="text-xs opacity-70">{string(footer.text)}</p>
          ) : null}
        </>
      ) : null}
      {commerce.reference_id ? (
        <p className="text-xs opacity-70">
          Order {string(commerce.reference_id)}
        </p>
      ) : null}
      {order.status ? <p>{string(order.status).replaceAll("_", " ")}</p> : null}
      {products.length ? <ProductRows rows={products} /> : null}
      {commerce.total_amount ? (
        <p className="font-medium">
          Total:{" "}
          {Number(object(commerce.total_amount).value) /
            Number(object(commerce.total_amount).offset || 100)}{" "}
          {string(commerce.currency)}
        </p>
      ) : null}
      {action.product_retailer_id ? <ProductRows rows={[action]} /> : null}
      {cards.length || templateCards.length || rendered?.cards?.length ? (
        <div className="chat-carousel" aria-label="Carousel cards">
          {cards.map((card, i) => (
            <div key={i}>
              <BusinessCard
                message={message}
                content={object(card)}
                fileIndex={fileIndex + i}
              />
            </div>
          ))}
          {(rendered?.cards ?? []).map((card, i) => (
            <div key={`rendered-${i}`}>
              <BusinessCard
                message={message}
                content={object(templateCards[i])}
                rendered={card}
                fileIndex={fileIndex + i}
              />
            </div>
          ))}
          {(!rendered?.cards?.length ? templateCards : []).map((raw, i) => {
            const card = object(raw)
            const parts = array(card.components).map(object)
            const head = parts.find((part) => part.type === "header")
            const bodyPart = parts.find((part) => part.type === "body")
            const headParam = object(array(head?.parameters)[0])
            return (
              <div key={i}>
                <BusinessCard
                  message={message}
                  fileIndex={fileIndex + i}
                  content={{
                    header: { type: headParam.type, ...headParam },
                    body: {
                      text: array(bodyPart?.parameters)
                        .map((parameter) => string(object(parameter).text))
                        .join(" "),
                    },
                    action: {
                      buttons: parts
                        .filter((part) => part.type === "button")
                        .map((part) => ({
                          type: part.sub_type,
                          title:
                            array(part.parameters)
                              .map(
                                (parameter) =>
                                  string(object(parameter).text) ||
                                  string(object(parameter).coupon_code)
                              )
                              .join(" ") || "Open",
                        })),
                    },
                  }}
                />
              </div>
            )
          })}
        </div>
      ) : null}
      {kind === "list" ? (
        <div className="chat-buttons">
          <ListOptions action={action} />
        </div>
      ) : (
        <AttachedButtons buttons={buttons} />
      )}
      {kind === "flow" || kind === "address_message" ? (
        <Dialog>
          <DialogTrigger className="chat-link text-xs underline">
            View form details
          </DialogTrigger>
          <DialogContent>
            <DialogTitle>
              {kind === "flow" ? "Flow" : "Address request"}
            </DialogTitle>
            <p>
              {string(parameters.flow_id) ||
                string(parameters.flow_name) ||
                string(parameters.country)}
            </p>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
}
export function LocationCard({
  location,
}: {
  location: Record<string, unknown>
}) {
  const lat = Number(location.latitude)
  const lng = Number(location.longitude)
  const valid =
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  return (
    <a
      className="block w-64 max-w-full"
      href={
        valid
          ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`
          : undefined
      }
      target="_blank"
      rel="noopener noreferrer"
    >
      <div className="chat-map">
        <MapPinIcon className="size-8" />
        <span>
          {valid ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : "Location"}
        </span>
      </div>
      <p className="mt-1 font-medium">{string(location.name) || "Location"}</p>
      <p className="text-xs opacity-70">{string(location.address)}</p>
    </a>
  )
}

function GenericCard({ content }: { content: Record<string, unknown> }) {
  const image = safeMessageUrl(content.image_url)
  return (
    <div className="flex flex-col gap-1">
      {image ? (
        <ConversationImage
          unoptimized
          width={640}
          height={480}
          src={image}
          alt={string(content.title) || "Card image"}
          loading="lazy"
          className="chat-image"
        />
      ) : null}{" "}
      {content.title ? (
        <p className="font-semibold">{string(content.title)}</p>
      ) : null}
      <FormattedText text={string(content.subtitle) || string(content.text)} />
      <AttachedButtons
        buttons={array(content.buttons).map((raw) => {
          const button = object(raw)
          return {
            type: button.type === "web_url" ? "URL" : string(button.type),
            text: string(button.title) || "Open",
            url: string(button.url),
          }
        })}
      />
    </div>
  )
}
