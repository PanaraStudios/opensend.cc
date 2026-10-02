"use node"
import { CallGatewayClient } from "../../services/call-gateway/src/client"
/** No per-call conversion: only upload completion and TTS render workers call this. */
export function normalizeIvrAudio(audio: Blob) {
  const url = process.env.CALL_GATEWAY_URL
  const secret = process.env.CALL_GATEWAY_SECRET
  if (!url || !secret)
    throw new Error("Configure the calling gateway before uploading IVR audio")
  return new CallGatewayClient(url, secret).normalizePrompt(audio)
}
