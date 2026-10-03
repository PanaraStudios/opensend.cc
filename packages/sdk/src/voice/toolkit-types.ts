/** Bot toolkit shapes, free of the SDK client so the dashboard can import them. */
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
