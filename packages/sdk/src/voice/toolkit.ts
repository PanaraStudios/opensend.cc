import type { PostOptions } from "../common/interfaces"
import type { Opensend } from "../resend"
import type { ChannelPage, ChannelRequestOptions } from "../channels/interfaces"
import type { PaginationOptions } from "../common/interfaces/pagination-options.interface"
import type {
  KnowledgeBaseInput,
  KnowledgeBase,
  KnowledgeDocumentInput,
  KnowledgeDocument,
  KnowledgeMatch,
  BotToolInput,
  BotTool,
} from "./toolkit-types"
export type * from "./toolkit-types"

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
  search(
    id: string,
    input: { query: string; limit?: number },
    requestOptions: PostOptions = {}
  ) {
    return this.resend.post<{ data: KnowledgeMatch[] }>(
      `/knowledge-bases/${idPath(id)}/search`,
      input,
      requestOptions
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
  test(
    id: string,
    input: Record<string, string | number | boolean>,
    requestOptions: PostOptions = {}
  ) {
    return this.resend.post<{
      ok: boolean
      result?: unknown
      error?: string
      latencyMs: number
    }>(`/bot-tools/${idPath(id)}/test`, input, requestOptions)
  }
}
