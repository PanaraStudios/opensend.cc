// @vitest-environment node
import dns from "node:dns/promises"
import https from "node:https"
import http from "node:http"
import { EventEmitter } from "node:events"
import { Readable } from "node:stream"
import type { IncomingMessage } from "node:http"
import { afterEach, expect, test, vi } from "vitest"
import { publicFetch } from "../lib/net/public-fetch"

afterEach(() => vi.restoreAllMocks())

function transport(status = 200, body = "OK", local = false) {
  const addresses: string[] = []
  const request = vi
    .spyOn(local ? http : https, "request")
    .mockImplementation((...args: unknown[]) => {
      const options = args[1] as https.RequestOptions
      const callback = args[2] as (response: IncomingMessage) => void
      const req = new EventEmitter()
      Object.assign(req, {
        end: () => {
          const record = (_error: unknown, result: unknown) => {
            addresses.push(
              typeof result === "string"
                ? result
                : (result as { address: string }[])[0].address
            )
          }
          // Node can request either form, and can invoke lookup more than once.
          options.lookup!("rebind.example", {}, record)
          options.lookup!("rebind.example", { all: true }, record)
          const incoming = Readable.from([Buffer.from(body)])
          Object.assign(incoming, {
            statusCode: status,
            headers: { location: "https://127.0.0.1/" },
          })
          callback(incoming as IncomingMessage)
        },
      })
      return req as ReturnType<typeof https.request>
    })
  return { request, addresses }
}

test("repeated socket lookups stay pinned when DNS rebinds; Host and TLS SNI stay original", async () => {
  const lookup = vi
    .spyOn(dns, "lookup")
    .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }] as never)
    .mockResolvedValue([{ address: "127.0.0.1", family: 4 }] as never)
  const { request, addresses } = transport()
  expect(
    await (await publicFetch("https://rebind.example:8443/hook")).text()
  ).toBe("OK")
  expect(lookup).toHaveBeenCalledTimes(1)
  expect(addresses).toEqual(["93.184.216.34", "93.184.216.34"])
  expect(request.mock.calls[0][1]).toMatchObject({
    agent: false,
    servername: "rebind.example",
    headers: { host: "rebind.example:8443" },
  })
  await expect(publicFetch("https://rebind.example/hook")).rejects.toThrow(
    "private network"
  )
  expect(request).toHaveBeenCalledTimes(1)
})

test.each([
  "127.0.0.1",
  "169.254.169.254",
  "10.0.0.1",
  "::1",
  "::ffff:127.0.0.1",
  "fe80::1",
])("rejects mixed DNS containing %s before connecting", async (address) => {
  vi.spyOn(dns, "lookup").mockResolvedValue([
    { address: "93.184.216.34", family: 4 },
    { address, family: address.includes(":") ? 6 : 4 },
  ] as never)
  const { request } = transport()
  await expect(publicFetch("https://rebind.example")).rejects.toThrow(
    "private network"
  )
  expect(request).not.toHaveBeenCalled()
})

test.each([
  "http://public.example",
  "https://127.0.0.1",
  "https://user:secret@public.example",
])("rejects unsafe URL %s without DNS", async (url) => {
  const lookup = vi.spyOn(dns, "lookup")
  await expect(publicFetch(url)).rejects.toThrow("public HTTPS")
  expect(lookup).not.toHaveBeenCalled()
})

test("redirects are returned without following their targets", async () => {
  vi.spyOn(dns, "lookup").mockResolvedValue([
    { address: "2606:4700::1111", family: 6 },
  ] as never)
  const { request, addresses } = transport(302)
  expect((await publicFetch("https://public.example")).status).toBe(302)
  expect(request).toHaveBeenCalledTimes(1)
  expect(addresses).toEqual(["2606:4700::1111", "2606:4700::1111"])
})

test.each([204, 205, 304])(
  "streaming accepts bodyless HTTP %s safely",
  async (status) => {
    vi.spyOn(dns, "lookup").mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ] as never)
    transport(status, "")
    const response = await publicFetch("https://public.example", {
      stream: true,
    })
    expect(response.status).toBe(status)
    expect(response.body).toBeNull()
  }
)

test("bounds bodies, with truncation only when requested", async () => {
  vi.spyOn(dns, "lookup").mockResolvedValue([
    { address: "93.184.216.34", family: 4 },
  ] as never)
  transport(200, "12345678")
  await expect(
    publicFetch("https://public.example", { maxBytes: 4 })
  ).rejects.toThrow("too large")
  expect(
    await (
      await publicFetch("https://public.example", {
        maxBytes: 4,
        truncate: true,
      })
    ).text()
  ).toBe("1234")
})

test("DNS itself is bounded by the request timeout", async () => {
  vi.spyOn(dns, "lookup").mockImplementation(() => new Promise(() => {}))
  const { request } = transport()
  await expect(
    publicFetch("https://public.example", { timeoutMs: 10 })
  ).rejects.toMatchObject({ name: "TimeoutError" })
  expect(request).not.toHaveBeenCalled()
})

test("an installation-approved local origin stays pinned and cannot allow another origin", async () => {
  vi.spyOn(dns, "lookup").mockResolvedValue([
    { address: "127.0.0.1", family: 4 },
  ] as never)
  const { request, addresses } = transport(200, "OK", true)
  const localOrigin = "http://host.docker.internal:8080"
  expect(
    (await publicFetch(`${localOrigin}/keys`, { localOrigin })).status
  ).toBe(200)
  expect(addresses).toEqual(["127.0.0.1", "127.0.0.1"])
  await expect(
    publicFetch("http://host.docker.internal:8081/keys", { localOrigin })
  ).rejects.toThrow("public HTTPS")
  await expect(
    publicFetch("https://rebind.example/keys", { localOrigin })
  ).rejects.toThrow("private network")
  expect(request).toHaveBeenCalledTimes(1)
})

test("prefers IPv4 and tries the next pinned address only when one is unreachable", async () => {
  vi.spyOn(dns, "lookup").mockResolvedValue([
    { address: "2606:4700::1", family: 6 },
    { address: "93.184.216.34", family: 4 },
    { address: "93.184.216.35", family: 4 },
  ] as never)
  const tried: string[] = []
  vi.spyOn(https, "request").mockImplementation((...args: unknown[]) => {
    const options = args[1] as https.RequestOptions
    const callback = args[2] as (response: IncomingMessage) => void
    const req = new EventEmitter()
    Object.assign(req, {
      end: () =>
        options.lookup!("host.example", {}, (_error, address) => {
          tried.push(address as string)
          if (tried.length === 1)
            req.emit(
              "error",
              Object.assign(new Error("connect ENETUNREACH"), {
                code: "ENETUNREACH",
              })
            )
          else {
            const incoming = Readable.from([Buffer.from("OK")])
            Object.assign(incoming, { statusCode: 200, headers: {} })
            callback(incoming as IncomingMessage)
          }
        }),
    })
    return req as ReturnType<typeof https.request>
  })
  expect(await (await publicFetch("https://host.example/")).text()).toBe("OK")
  expect(tried).toEqual(["93.184.216.34", "93.184.216.35"])
})

test("sends DELETE and byte bodies unchanged", async () => {
  vi.spyOn(dns, "lookup").mockResolvedValue([
    { address: "93.184.216.34", family: 4 },
  ] as never)
  const sent: { method?: string; body: unknown }[] = []
  vi.spyOn(https, "request").mockImplementation((...args: unknown[]) => {
    const options = args[1] as https.RequestOptions
    const callback = args[2] as (response: IncomingMessage) => void
    const req = new EventEmitter()
    Object.assign(req, {
      end: (body: unknown) => {
        sent.push({ method: options.method, body })
        const incoming = Readable.from([Buffer.from("OK")])
        Object.assign(incoming, { statusCode: 200, headers: {} })
        callback(incoming as IncomingMessage)
      },
    })
    return req as ReturnType<typeof https.request>
  })
  const bytes = new Uint8Array([0, 1, 2, 255])
  await publicFetch("https://public.example/media", {
    method: "POST",
    body: bytes,
  })
  await publicFetch("https://public.example/media/1", { method: "DELETE" })
  expect(sent).toEqual([
    { method: "POST", body: bytes },
    { method: "DELETE", body: undefined },
  ])
})
