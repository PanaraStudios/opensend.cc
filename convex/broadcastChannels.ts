import type { Doc } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import type { BroadcastInput } from "./broadcasts"
import { draft } from "./broadcasts"
import {
  resolveWhatsAppSend,
  sendMessagingRecipients,
} from "./broadcastWhatsApp"
import {
  validateEmailBroadcast,
  initializeEmailBroadcast,
  eligibleEmailRecipients,
  prepareEmailBroadcast,
  sendEmailRecipient,
  emailSendRate,
} from "./broadcastEmail"
import { readBroadcastStats, readWhatsAppStats } from "./broadcastMetrics"
import { resolvePageBroadcast } from "./broadcastMessaging"
import { channelStrategies } from "../lib/meta/payloads"
import {
  type Channel,
  type MessagingChannel,
  type PageChannel,
  rowChannel,
} from "../lib/channels"

// One strategy per supported broadcast channel. Legacy email fields and
// retained snapshots remain unchanged; adapters tag read results at the edge.
type Prepared =
  | Awaited<ReturnType<typeof prepareEmailBroadcast>>
  | {
      channel: MessagingChannel
      target:
        | NonNullable<Awaited<ReturnType<typeof resolveWhatsAppSend>>>
        | Awaited<ReturnType<typeof resolvePageBroadcast>>
    }
type Adapter = {
  validate(
    ctx: MutationCtx,
    org: string,
    input: BroadcastInput,
    sending?: boolean
  ): Promise<void>
  initialize(
    ctx: QueryCtx,
    org: string,
    input: BroadcastInput
  ): Promise<BroadcastInput>
  prepare(ctx: QueryCtx, row: Doc<"broadcasts">): Promise<Prepared>
  eligible(
    ctx: QueryCtx,
    row: Pick<Doc<"broadcasts">, "organizationId">,
    candidates: Doc<"contacts">[],
    topic: Doc<"topics"> | null,
    sending: boolean
  ): Promise<Doc<"contacts">[]>
  /** A fan-out step's recipients, in order, until `more` says the
      transaction is full. Returns how many contacts it got through
      (`written`), how many messages it queued, and when the last reserved
      send may go, if the step reserved them. */
  sendRecipients(
    ctx: MutationCtx,
    row: Doc<"broadcasts">,
    contacts: Doc<"contacts">[],
    topic: Doc<"topics"> | null,
    prepared: Prepared,
    more: () => Promise<boolean>
  ): Promise<{ written: number; queued: number; readyAt?: number }>
  /** Sends per second the step's sender takes, which paces the fan-out. */
  rate(ctx: QueryCtx, prepared: Prepared): Promise<number>
  readStats(
    ctx: QueryCtx,
    row: Doc<"broadcasts">
  ): Promise<
    | {
        channel: "email"
        stats: Awaited<ReturnType<typeof readBroadcastStats>>
      }
    | {
        channel: MessagingChannel
        stats: Awaited<ReturnType<typeof readWhatsAppStats>>
      }
  >
  retained(row: Doc<"broadcasts">): boolean
}
function pageAdapter(channel: PageChannel): Adapter {
  return {
    validate: async (ctx, org, input, sending = false) => {
      if (input.whatsapp)
        throw new Error("Use messaging settings for this channel")
      if (input.messaging || sending)
        await resolvePageBroadcast(ctx, org, channel, input.messaging, {
          draft: !sending,
        })
    },
    initialize: async (_ctx, _org, input) => input,
    prepare: async (ctx, row) => ({
      channel,
      target: await resolvePageBroadcast(
        ctx,
        row.organizationId,
        channel,
        row.messaging
      ),
    }),
    eligible: async (_ctx, _row, candidates) => candidates,
    sendRecipients: async (ctx, row, contacts, topic, prepared, more) => {
      if (prepared.channel !== channel)
        throw new Error("Invalid broadcast preparation")
      return sendMessagingRecipients(
        ctx,
        row,
        contacts,
        topic,
        prepared.target,
        more
      )
    },
    rate: async (_ctx, prepared) => messagingRate(prepared),
    readStats: async (ctx, row) => ({
      channel,
      stats:
        row.retainedWhatsAppStats ?? (await readWhatsAppStats(ctx, row._id)),
    }),
    retained: (row) => !!row.retainedWhatsAppStats,
  }
}
/** The sending number's rate on the channel's limiter. */
function messagingRate(prepared: Prepared) {
  if (prepared.channel === "email")
    throw new Error("Invalid broadcast preparation")
  const { account } = prepared.target
  return channelStrategies[account.channel].rate(account).rate
}
export const broadcastChannels: Record<Channel, Adapter> = {
  email: {
    validate: (ctx, org, input, sending = false) =>
      validateEmailBroadcast(ctx, org, input, sending),
    initialize: initializeEmailBroadcast,
    prepare: prepareEmailBroadcast,
    eligible: eligibleEmailRecipients,
    sendRecipients: async (ctx, row, contacts, topic, prepared, more) => {
      if (prepared.channel !== "email")
        throw new Error("Invalid broadcast preparation")
      let written = 0,
        queued = 0
      for (const contact of contacts) {
        if (await sendEmailRecipient(ctx, row, contact, topic, prepared))
          queued++
        written++
        if (written < contacts.length && !(await more())) break
      }
      return { written, queued }
    },
    rate: async (ctx, prepared) => {
      if (prepared.channel !== "email")
        throw new Error("Invalid broadcast preparation")
      return emailSendRate(ctx, prepared)
    },
    readStats: async (ctx, row) => ({
      channel: "email",
      stats: row.retainedStats ?? (await readBroadcastStats(ctx, row._id)),
    }),
    retained: (row) => !!row.retainedStats,
  },
  messenger: pageAdapter("messenger"),
  instagram: pageAdapter("instagram"),
  whatsapp: {
    validate: async (ctx, org, input, sending = false) => {
      if (input.whatsapp || sending)
        await resolveWhatsAppSend(ctx, org, input.whatsapp, { draft: !sending })
    },
    initialize: async (_ctx, _org, input) => input,
    prepare: async (ctx, row) => ({
      channel: "whatsapp",
      target: (await resolveWhatsAppSend(
        ctx,
        row.organizationId,
        row.whatsapp
      ))!,
    }),
    eligible: async (_ctx, _row, candidates) => candidates,
    sendRecipients: async (ctx, row, contacts, topic, prepared, more) => {
      if (prepared.channel !== "whatsapp")
        throw new Error("Invalid broadcast preparation")
      return sendMessagingRecipients(
        ctx,
        row,
        contacts,
        topic,
        prepared.target,
        more
      )
    },
    rate: async (_ctx, prepared) => messagingRate(prepared),
    readStats: async (ctx, row) => ({
      channel: "whatsapp",
      stats:
        row.retainedWhatsAppStats ?? (await readWhatsAppStats(ctx, row._id)),
    }),
    retained: (row) => !!row.retainedWhatsAppStats,
  },
}
export async function validateBroadcastSend(
  ctx: MutationCtx,
  row: Doc<"broadcasts">
) {
  const channel = rowChannel(row)
  const body = channel === "email" ? await draft(ctx, row._id) : null
  await broadcastChannels[channel].validate(
    ctx,
    row.organizationId,
    { ...row, html: body?.html, text: body?.text },
    true
  )
}
/** Keep both existing storage fields readable without a live-data migration. */
export async function retainedBroadcastStats(
  ctx: QueryCtx,
  row: Doc<"broadcasts">
) {
  const result = await broadcastChannels[rowChannel(row)].readStats(ctx, row)
  return result.channel === "email"
    ? { retainedStats: result.stats }
    : {
        retainedWhatsAppStats: result.stats,
        retainedStats:
          row.retainedStats ?? (await readBroadcastStats(ctx, row._id)),
      }
}
