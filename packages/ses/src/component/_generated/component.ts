/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server"

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    lib: {
      cancelEmail: FunctionReference<
        "mutation",
        "internal",
        { emailId: string },
        null,
        Name
      >
      cleanupAbandonedEmails: FunctionReference<
        "mutation",
        "internal",
        { olderThan?: number },
        null,
        Name
      >
      cleanupOldEmails: FunctionReference<
        "mutation",
        "internal",
        { olderThan?: number },
        null,
        Name
      >
      createManualEmail: FunctionReference<
        "mutation",
        "internal",
        {
          bcc?: Array<string> | string
          cc?: Array<string> | string
          configurationSetName?: string
          from: string
          headers?: Array<{ name: string; value: string }>
          onEmailEvent?: { fnHandle: string }
          replyTo?: Array<string>
          subject: string
          tags?: Array<{ name: string; value: string }>
          testMode?: boolean
          to: Array<string> | string
        },
        string,
        Name
      >
      get: FunctionReference<
        "query",
        "internal",
        { emailId: string },
        {
          bcc?: Array<string>
          bounced: boolean
          cc?: Array<string>
          clicked: boolean
          complained: boolean
          configurationSetName?: string
          createdAt: number
          deliveryDelayed: boolean
          errorMessage?: string
          failed: boolean
          finalizedAt: number
          from: string
          headers?: Array<{ name: string; value: string }>
          html?: string
          idempotencyKey?: string
          opened: boolean
          replyTo: Array<string>
          segment: number
          sesMessageId?: string
          status:
            | "waiting"
            | "queued"
            | "cancelled"
            | "sent"
            | "delivered"
            | "delivery_delayed"
            | "bounced"
            | "failed"
          subject?: string
          tags?: Array<{ name: string; value: string }>
          template?: {
            arn?: string
            content?: { html?: string; subject?: string; text?: string }
            data?: Record<string, any>
            name?: string
          }
          text?: string
          to: Array<string>
        } | null,
        Name
      >
      getStatus: FunctionReference<
        "query",
        "internal",
        { emailId: string },
        {
          bounced: boolean
          clicked: boolean
          complained: boolean
          deliveryDelayed: boolean
          errorMessage: string | null
          failed: boolean
          opened: boolean
          sesMessageId: string | null
          status:
            | "waiting"
            | "queued"
            | "cancelled"
            | "sent"
            | "delivered"
            | "delivery_delayed"
            | "bounced"
            | "failed"
        } | null,
        Name
      >
      handleEmailEvent: FunctionReference<
        "mutation",
        "internal",
        { event: any; notificationId?: string },
        null | boolean,
        Name
      >
      sendEmail: FunctionReference<
        "mutation",
        "internal",
        {
          bcc?: Array<string>
          cc?: Array<string>
          configurationSetName?: string
          from: string
          headers?: Array<{ name: string; value: string }>
          html?: string
          idempotencyKey?: string
          options: {
            configurationSetName?: string
            credentials: {
              accessKeyId: string
              secretAccessKey: string
              sessionToken?: string
            }
            initialBackoffMs: number
            maxSendRate: number
            onEmailEvent?: { fnHandle: string }
            region: string
            retryAttempts: number
            testMode: boolean
          }
          replyTo?: Array<string>
          subject?: string
          tags?: Array<{ name: string; value: string }>
          template?: {
            arn?: string
            content?: { html?: string; subject?: string; text?: string }
            data?: Record<string, any>
            name?: string
          }
          text?: string
          to: Array<string>
        },
        string,
        Name
      >
      updateManualEmail: FunctionReference<
        "mutation",
        "internal",
        {
          emailId: string
          errorMessage?: string
          sesMessageId?: string
          status:
            | "waiting"
            | "queued"
            | "cancelled"
            | "sent"
            | "delivered"
            | "delivery_delayed"
            | "bounced"
            | "failed"
        },
        null,
        Name
      >
    }
  }
