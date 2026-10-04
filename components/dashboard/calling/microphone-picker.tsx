"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { OptionSelect } from "@/components/dashboard/primitives"
import { actionError } from "@/lib/action-error"

/** Preview owns its own stream and releases it when the panel closes. */
export function MicrophonePicker({
  value,
  online,
  onChange,
  disabled,
}: {
  value: string
  online: boolean
  onChange: (value: string) => void
  disabled: boolean
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [level, setLevel] = useState(0)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState("")
  const preview = useRef<{
    stream?: MediaStream
    context: AudioContext
    frame: number
  } | null>(null)
  const generation = useRef(0)
  const refresh = () =>
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((all) => {
        setDevices(all.filter((d) => d.kind === "audioinput"))
      })
      .catch(() => undefined)
  function stop() {
    generation.current++
    const current = preview.current
    preview.current = null
    if (current) {
      cancelAnimationFrame(current.frame)
      current.stream?.getTracks().forEach((track) => track.stop())
      void current.context.close().catch(() => undefined)
    }
  }
  async function start() {
    stop()
    const ticket = generation.current
    setError("")
    const context = new AudioContext()
    const current: NonNullable<typeof preview.current> = { context, frame: 0 }
    preview.current = current
    try {
      await context.resume()
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: value === "default" ? true : { deviceId: { exact: value } },
        video: false,
      })
      if (ticket !== generation.current) {
        stream.getTracks().forEach((track) => track.stop())
        await context.close()
        return
      }
      const analyser = context.createAnalyser()
      analyser.fftSize = 256
      context.createMediaStreamSource(stream).connect(analyser)
      const samples = new Uint8Array(analyser.fftSize)
      current.stream = stream
      setTesting(true)
      void refresh()
      const tick = () => {
        if (preview.current !== current) return
        analyser.getByteTimeDomainData(samples)
        const rms = Math.sqrt(
          samples.reduce((sum, n) => sum + ((n - 128) / 128) ** 2, 0) /
            samples.length
        )
        setLevel(Math.min(100, Math.round(rms * 400)))
        current.frame = requestAnimationFrame(tick)
      }
      tick()
    } catch (reason) {
      await context.close().catch(() => undefined)
      if (preview.current === current) preview.current = null
      if (ticket === generation.current) {
        setTesting(false)
        setError(actionError(reason))
      }
    }
  }
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (online && !disabled) void start()
      else {
        setTesting(false)
        setLevel(0)
      }
    })
    return () => {
      cancelAnimationFrame(frame)
      stop()
    }
    // Each picker mount and selected device owns exactly one preview stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, value, disabled])
  useEffect(() => {
    void refresh()
    navigator.mediaDevices?.addEventListener("devicechange", refresh)
    return () => {
      navigator.mediaDevices?.removeEventListener("devicechange", refresh)
      stop()
    }
  }, [])
  return (
    <Field>
      <FieldLabel>Microphone</FieldLabel>
      <OptionSelect
        aria-label="Softphone microphone"
        value={value}
        disabled={disabled}
        items={[
          { value: "default", label: "Default microphone" },
          ...devices
            .filter((d) => d.deviceId !== "default")
            .map((d, i) => ({
              value: d.deviceId,
              label: d.label || `Microphone ${i + 1}`,
            })),
        ]}
        onChange={(next) => {
          stop()
          setTesting(false)
          setLevel(0)
          onChange(next)
        }}
      />
      <div className="flex items-center gap-3">
        <div
          role="meter"
          aria-label="Microphone level"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={level}
          aria-valuetext={testing ? `${level}%` : "Microphone preview stopped"}
          className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full bg-primary" style={{ width: `${level}%` }} />
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={() => {
            if (testing) {
              stop()
              setTesting(false)
              setLevel(0)
            } else void start()
          }}
        >
          {testing ? "Stop test" : "Test microphone"}
        </Button>
      </div>
      {testing && (
        <p className="text-xs text-muted-foreground">
          Speak to check your microphone.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </Field>
  )
}
