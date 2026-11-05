"use client"
import { useQuery } from "convex/react"
import { api } from "@opensend/backend/api"
/** The public installation projection contains capabilities, never Meta secrets. */
export function useInstanceChannels(enabled = true) {
  const status = useQuery(api.installation.status, enabled ? {} : "skip")
  return status ? { ...status.channels, admin: status.admin } : undefined
}
