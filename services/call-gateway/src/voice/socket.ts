import WebSocket from "ws"
export type SocketFactory = (
  url: string,
  headers: Record<string, string>
) => WebSocket
export const providerSocket: SocketFactory = (url, headers) =>
  new WebSocket(url, {
    headers,
    maxPayload: 2 * 1024 * 1024,
    handshakeTimeout: 10000,
  })
export function send(socket: WebSocket | undefined, value: unknown) {
  if (socket?.readyState !== WebSocket.OPEN) return false
  if (socket.bufferedAmount > 1024 * 1024)
    throw new Error("Provider backpressure limit")
  socket.send(JSON.stringify(value))
  return true
}
export async function opened(socket: WebSocket) {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.terminate()
      reject(new Error("Provider connection timed out"))
    }, 10000)
    const done = (error?: Error) => {
      clearTimeout(timer)
      socket.off("open", ready)
      socket.off("error", failed)
      socket.off("close", closed)
      if (error) reject(error)
      else resolve()
    }
    const ready = () => done()
    const failed = () => done(new Error("Provider connection failed"))
    const closed = () => done(new Error("Provider closed before ready"))
    socket.once("open", ready)
    socket.once("error", failed)
    socket.once("close", closed)
  })
}
export function json(data: WebSocket.RawData): Record<string, unknown> {
  const parsed: unknown = JSON.parse(data.toString())
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Invalid provider message")
  return parsed as Record<string, unknown>
}
export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
