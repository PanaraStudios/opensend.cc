import type { Doc } from "@opensend/backend/dataModel"
import type { ApiLog } from "@opensend/core/dashboard/types"

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
