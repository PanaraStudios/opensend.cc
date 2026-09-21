"use client"
import { useSyncExternalStore } from "react"

const listeners = new Set<() => void>()
let currentTime = Date.now()
let timer: ReturnType<typeof setInterval> | undefined
function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!timer) {
    currentTime = Date.now()
    timer = setInterval(() => {
      currentTime = Date.now()
      for (const notify of listeners) notify()
    }, 30_000)
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size && timer) {
      clearInterval(timer)
      timer = undefined
    }
  }
}
const snapshot = () => currentTime
const serverSnapshot = () => null
/** One browser clock for all relative dates; stable, timezone-neutral SSR. */
export function useClock() {
  return useSyncExternalStore<number | null>(
    subscribe,
    snapshot,
    serverSnapshot
  )
}
