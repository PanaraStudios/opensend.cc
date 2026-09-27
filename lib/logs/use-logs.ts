import type { Doc } from "@/convex/_generated/dataModel"
import type { ApiLog } from "@/lib/dashboard/types"

export function asLog(row: Doc<"apiLogs">): ApiLog {
  return {
    id: row._id,
    method: row.method,
    path: row.path,
    status: row.status,
    createdAt: row._creationTime,
    durationMs: row.durationMs,
    emailId: row.emailId ?? null,
    userAgent: row.userAgent,
    source: row.source,
    apiKeyId: row.apiKeyId ?? null,
  }
}
