import dns from "node:dns/promises"
import https from "node:https"
import http from "node:http"
import {
  isPublicAddress,
  isPublicHostname,
  localHttpOrigin,
} from "./public-host"

export type PublicFetchOptions = {
  method?: "GET" | "POST" | "DELETE"
  headers?: Record<string, string>
  /** Text, or bytes such as a multipart media upload. */
  body?: string | Uint8Array
  timeoutMs?: number
  maxBytes?: number
  truncate?: boolean
  /** Installation-authorized local development only, never derived from DNS. */
  localOrigin?: string
}

/** Node only. Resolve once, then give TLS only the validated address. A new
    connection per request prevents pools from bypassing the address check. */
export async function publicFetch(
  input: string | URL,
  options: PublicFetchOptions = {}
): Promise<Response> {
  const url = new URL(input)
  const local =
    options.localOrigin !== undefined &&
    localHttpOrigin(options.localOrigin) === url.origin
  if (
    url.username ||
    url.password ||
    (!local && (url.protocol !== "https:" || !isPublicHostname(url.hostname)))
  )
    throw new Error("The endpoint must be a public HTTPS URL")
  const signal = AbortSignal.timeout(options.timeoutMs ?? 10_000)
  const addresses = await new Promise<Awaited<ReturnType<typeof resolve>>>(
    (resolveLookup, reject) => {
      const abort = () => reject(signal.reason)
      signal.addEventListener("abort", abort, { once: true })
      resolve(url.hostname)
        .then(resolveLookup, reject)
        .finally(() => {
          signal.removeEventListener("abort", abort)
        })
    }
  )
  if (
    !addresses.length ||
    (!local && addresses.some(({ address }) => !isPublicAddress(address)))
  )
    throw new Error("The endpoint resolves to a private network address")
  signal.throwIfAborted()
  // IPv4 first: container networks often have no IPv6 route. Each attempt
  // stays pinned to one validated address; only a failed connection moves on.
  const ordered = [
    ...addresses.filter((address) => address.family === 4),
    ...addresses.filter((address) => address.family !== 4),
  ]
  for (const [index, pinned] of ordered.entries()) {
    try {
      return await request(url, local, pinned, options, signal)
    } catch (error) {
      const last = index === ordered.length - 1
      if (last || signal.aborted || !isUnreachableError(error)) throw error
    }
  }
  throw new Error("The endpoint has no reachable address")
}

type Address = { address: string; family: number }

/** Errors raised before any byte was exchanged with that address. */
export const isUnreachableError = (error: unknown) =>
  error instanceof Error &&
  "code" in error &&
  [
    "ENETUNREACH",
    "EHOSTUNREACH",
    "ECONNREFUSED",
    "EADDRNOTAVAIL",
    "ENOTFOUND",
    "EAI_AGAIN",
  ].includes(String(error.code))

function request(
  url: URL,
  local: boolean,
  pinned: Address,
  options: PublicFetchOptions,
  signal: AbortSignal
): Promise<Response> {
  return new Promise((resolveResponse, reject) => {
    const request = (local ? http : https).request(
      url,
      {
        method: options.method ?? "GET",
        headers: {
          ...options.headers,
          host: url.host,
          "accept-encoding": "identity",
        },
        agent: false,
        servername: url.hostname,
        signal,
        lookup: (_hostname, lookupOptions, callback) => {
          if (lookupOptions.all) callback(null, [pinned])
          else callback(null, pinned.address, pinned.family)
        },
      },
      (incoming) => {
        const headers = new Headers()
        for (const [key, value] of Object.entries(incoming.headers))
          if (value !== undefined)
            for (const item of Array.isArray(value) ? value : [value])
              headers.append(key, item)
        const chunks: Buffer[] = []
        let size = 0
        const limit = options.maxBytes ?? 1024 * 1024
        const finish = () => {
          const status = incoming.statusCode ?? 502
          resolveResponse(
            new Response(
              [204, 205, 304].includes(status)
                ? null
                : new Uint8Array(Buffer.concat(chunks)),
              { status, headers }
            )
          )
        }
        incoming.on("data", (chunk: Buffer) => {
          const remaining = limit - size
          size += chunk.length
          if (size > limit) {
            if (options.truncate) {
              chunks.push(chunk.subarray(0, remaining))
              finish()
              incoming.destroy()
            } else incoming.destroy(new Error("Response body too large"))
            return
          }
          chunks.push(chunk)
        })
        incoming.on("end", finish)
        incoming.on("error", reject)
      }
    )
    request.on("error", (error) =>
      reject(signal.aborted ? signal.reason : error)
    )
    // https.request never follows redirects, including redirects to the same host.
    request.end(options.body)
  })
}

const resolve = (hostname: string) =>
  dns.lookup(hostname, { all: true, verbatim: true })
