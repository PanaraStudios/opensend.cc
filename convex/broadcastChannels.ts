import type { Doc } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import type { BroadcastInput } from "./broadcasts"
import { draft } from "./broadcasts"
import { resolveWhatsAppSend, sendWhatsAppRecipient } from "./broadcastWhatsApp"
import {
  validateEmailBroadcast,
  initializeEmailBroadcast,
  eligibleEmailRecipients,
  prepareEmailBroadcast,
  sendEmailRecipient,
} from "./broadcastEmail"
import { readBroadcastStats, readWhatsAppStats } from "./broadcastMetrics"
import { resolvePageBroadcast } from "./broadcastMessaging"
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
  sendRecipient(
    ctx: MutationCtx,
    row: Doc<"broadcasts">,
    contact: Doc<"contacts">,
    topic: Doc<"topics"> | null,
    prepared: Prepared
  ): Promise<void>
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
    sendRecipient: async (ctx, row, contact, topic, prepared) => {
      if (prepared.channel !== channel)
        throw new Error("Invalid broadcast preparation")
      await sendWhatsAppRecipient(ctx, row, contact, topic, prepared.target)
    },
    readStats: async (ctx, row) => ({
      channel,
      stats:
        row.retainedWhatsAppStats ?? (await readWhatsAppStats(ctx, row._id)),
    }),
    retained: (row) => !!row.retainedWhatsAppStats,
  }
}
export const broadcastChannels: Record<Channel, Adapter> = {
  email: {
    validate: (ctx, org, input, sending = false) =>
      validateEmailBroadcast(ctx, org, input, sending),
    initialize: initializeEmailBroadcast,
    prepare: prepareEmailBroadcast,
    eligible: eligibleEmailRecipients,
    sendRecipient: async (ctx, row, contact, topic, prepared) => {
      if (prepared.channel !== "email")
        throw new Error("Invalid broadcast preparation")
      await sendEmailRecipient(ctx, row, contact, topic, prepared)
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
    sendRecipient: async (ctx, row, contact, topic, prepared) => {
      if (prepared.channel !== "whatsapp")
        throw new Error("Invalid broadcast preparation")
      await sendWhatsAppRecipient(ctx, row, contact, topic, prepared.target)
    },
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
