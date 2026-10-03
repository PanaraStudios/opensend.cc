import type { Opensend } from "../resend"
import type { ChannelPage, ChannelRequestOptions } from "../channels/interfaces"
import type { PaginationOptions } from "../common/interfaces/pagination-options.interface"
export type CollectField = {
  key: string
  label: string
  description: string
  type: "text" | "number" | "boolean" | "email" | "phone" | "date" | "enum"
  options?: string[]
  required: boolean
  contactProperty?: string
}
export type CollectedData = Record<
  string,
  { value: string | number | boolean; inferred: boolean }
>
export type KnowledgeBaseInput = { name: string; description?: string }
export type KnowledgeBase = KnowledgeBaseInput & {
  id: string
  status: "processing" | "ready" | "failed"
  createdAt: number
  updatedAt: number
}
export type KnowledgeDocumentInput = { title: string } & (
  | { source: "text"; text: string }
  | { source: "url"; url: string }
  | { source: "upload"; fileId: string }
)
export type KnowledgeDocument = {
  id: string
  knowledgeBaseId: string
  title: string
  source: "text" | "url" | "upload"
  text?: string
  url?: string
  fileId?: string
  storageId?: string
  byteSize: number
  status: "processing" | "ready" | "failed"
  error?: string
  revision: string
  createdAt: number
  updatedAt: number
}
export type KnowledgeMatch = {
  id: string
  documentId: string
  knowledgeBaseId: string
  title: string
  text: string
  position: number
  score: number
}
export type BotToolParameters = {
  type: "object"
  properties: Record<
    string,
    {
      type: "string" | "number" | "boolean"
      description?: string
      enum?: (string | number | boolean)[]
    }
  >
  required?: string[]
  additionalProperties?: false
}
export type BotToolInput = {
  name: string
  description: string
  parameters: BotToolParameters
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  url: string
  headers?: Record<string, string>
  signingSecret?: string
  timeoutMs?: number
  resultFields?: string[]
}
export type BotTool = Omit<BotToolInput, "headers" | "signingSecret"> & {
  id: string
  createdAt: number
  updatedAt: number
}
function query(options: PaginationOptions) {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(options))
    if (v !== undefined) params.set(k, String(v))
  return params.toString()
}
const idPath = (id: string) => encodeURIComponent(id)
export class KnowledgeDocuments {
  constructor(private readonly resend: Opensend) {}
  create(
    base: string,
    input: KnowledgeDocumentInput,
    options?: ChannelRequestOptions
  ) {
    return this.resend.post<{ id: string }>(
      `/knowledge-bases/${idPath(base)}/documents`,
      input,
      options
    )
  }
  list(base: string, options: PaginationOptions = {}) {
    return this.resend.get<ChannelPage<KnowledgeDocument>>(
      `/knowledge-bases/${idPath(base)}/documents?${query(options)}`
    )
  }
  get(base: string, id: string) {
    return this.resend.get<KnowledgeDocument>(
      `/knowledge-bases/${idPath(base)}/documents/${idPath(id)}`
    )
  }
  update(base: string, id: string, input: Partial<KnowledgeDocumentInput>) {
    return this.resend.patch<{ id: string }>(
      `/knowledge-bases/${idPath(base)}/documents/${idPath(id)}`,
      input
    )
  }
  remove(base: string, id: string) {
    return this.resend.delete<{ id: string; deleted: boolean }>(
      `/knowledge-bases/${idPath(base)}/documents/${idPath(id)}`
    )
  }
}
export class KnowledgeBases {
  readonly documents: KnowledgeDocuments
  constructor(private readonly resend: Opensend) {
    this.documents = new KnowledgeDocuments(resend)
  }
  create(input: KnowledgeBaseInput, options?: ChannelRequestOptions) {
    return this.resend.post<{ id: string }>("/knowledge-bases", input, options)
  }
  list(options: PaginationOptions = {}) {
    return this.resend.get<ChannelPage<KnowledgeBase>>(
      `/knowledge-bases?${query(options)}`
    )
  }
  get(id: string) {
    return this.resend.get<KnowledgeBase>(`/knowledge-bases/${idPath(id)}`)
  }
  update(id: string, input: Partial<KnowledgeBaseInput>) {
    return this.resend.patch<{ id: string }>(
      `/knowledge-bases/${idPath(id)}`,
      input
    )
  }
  remove(id: string) {
    return this.resend.delete<{ id: string; deleted: boolean }>(
      `/knowledge-bases/${idPath(id)}`
    )
  }
  search(id: string, input: { query: string; limit?: number }) {
    return this.resend.post<{ data: KnowledgeMatch[] }>(
      `/knowledge-bases/${idPath(id)}/search`,
      input
    )
  }
}
export class BotTools {
  constructor(private readonly resend: Opensend) {}
  create(input: BotToolInput, options?: ChannelRequestOptions) {
    return this.resend.post<{ id: string }>("/bot-tools", input, options)
  }
  list(options: PaginationOptions = {}) {
    return this.resend.get<ChannelPage<BotTool>>(`/bot-tools?${query(options)}`)
  }
  get(id: string) {
    return this.resend.get<BotTool>(`/bot-tools/${idPath(id)}`)
  }
  update(id: string, input: Partial<BotToolInput>) {
    return this.resend.patch<{ id: string }>(`/bot-tools/${idPath(id)}`, input)
  }
  remove(id: string) {
    return this.resend.delete<{ id: string; deleted: boolean }>(
      `/bot-tools/${idPath(id)}`
    )
  }
  test(id: string, input: Record<string, string | number | boolean>) {
    return this.resend.post<{
      ok: boolean
      result?: unknown
      error?: string
      latencyMs: number
    }>(`/bot-tools/${idPath(id)}/test`, input)
  }
}
