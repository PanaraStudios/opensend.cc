/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

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
        boolean,
        Name
      >;
      cleanupOldEmails: FunctionReference<
        "mutation",
        "internal",
        { olderThan?: number },
        null,
        Name
      >;
      get: FunctionReference<
        "query",
        "internal",
        { emailId: string },
        null | {
          _creationTime: number;
          _id: string;
          attachments?: Array<{
            content?: string;
            contentId?: string;
            contentType?: string;
            filename?: string;
            id?: string;
            path?: string;
          }>;
          bcc?: Array<string>;
          cc?: Array<string>;
          clicked: boolean;
          complained: boolean;
          errorMessage?: string;
          finalizedAt: number;
          from?: string;
          headers?: Record<string, string>;
          html?: string;
          opened: boolean;
          opensendId?: string;
          replyTo?: Array<string>;
          scheduledAt?: string;
          status:
            | "queued"
            | "cancelled"
            | "sent"
            | "delivery_delayed"
            | "delivered"
            | "bounced"
            | "failed";
          subject?: string;
          tags?: Array<{ name: string; value: string }>;
          template?: {
            id: string;
            variables?: Record<string, string | number>;
          };
          text?: string;
          to: Array<string>;
          topicId?: string;
        },
        Name
      >;
      handleEmailEvent: FunctionReference<
        "mutation",
        "internal",
        {
          event: {
            componentEmailId?: string;
            message?: string;
            opensendId: string;
            type:
              | "email.sent"
              | "email.delivery_delayed"
              | "email.delivered"
              | "email.bounced"
              | "email.failed"
              | "email.suppressed"
              | "email.complained"
              | "email.opened"
              | "email.clicked";
          };
        },
        null,
        Name
      >;
      sendEmail: FunctionReference<
        "mutation",
        "internal",
        {
          delivery: {
            apiKey: string;
            baseUrl: string;
            initialBackoffMs: number;
            maxAttempts: number;
          };
          email: {
            attachments?: Array<{
              content?: string;
              contentId?: string;
              contentType?: string;
              filename?: string;
              id?: string;
              path?: string;
            }>;
            bcc?: Array<string>;
            cc?: Array<string>;
            from?: string;
            headers?: Record<string, string>;
            html?: string;
            replyTo?: Array<string>;
            scheduledAt?: string;
            subject?: string;
            tags?: Array<{ name: string; value: string }>;
            template?: {
              id: string;
              variables?: Record<string, string | number>;
            };
            text?: string;
            to: Array<string>;
            topicId?: string;
          };
          enqueueKey?: string;
          onEmailEvent?: string;
        },
        string,
        Name
      >;
      status: FunctionReference<
        "query",
        "internal",
        { emailId: string },
        null | {
          clicked: boolean;
          complained: boolean;
          errorMessage?: string;
          opened: boolean;
          opensendId?: string;
          status:
            | "queued"
            | "cancelled"
            | "sent"
            | "delivery_delayed"
            | "delivered"
            | "bounced"
            | "failed";
        },
        Name
      >;
    };
  };
