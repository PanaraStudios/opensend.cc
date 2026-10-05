import { publicFetch } from "../net/public-fetch.js"
import { record } from "./toolkit.js"

export const EMBEDDING_MODEL = "gemini-embedding-001"
export async function embedText(
  key: string,
  input: string,
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
  title?: string,
  fetcher: typeof publicFetch = publicFetch
): Promise<number[]> {
  const response = await fetcher(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        model: `models/${EMBEDDING_MODEL}`,
        content: { parts: [{ text: input }] },
        taskType,
        outputDimensionality: 768,
        ...(title && taskType === "RETRIEVAL_DOCUMENT" ? { title } : {}),
      }),
      timeoutMs: 10000,
      maxBytes: 64 * 1024,
    }
  )
  if (!response.ok)
    throw new Error(
      `Gemini embedding request failed (HTTP ${response.status}); check the team's Gemini key and quota`
    )
  const body = record(await response.json()),
    embedding = record(body.embedding),
    values = embedding.values
  if (
    !Array.isArray(values) ||
    values.length !== 768 ||
    values.some((v) => typeof v !== "number" || !Number.isFinite(v))
  )
    throw new Error("Gemini returned an invalid embedding")
  const norm = Math.hypot(...values)
  if (!Number.isFinite(norm) || !norm)
    throw new Error("Gemini returned an invalid embedding magnitude")
  return values.map((v: number) => v / norm)
}
