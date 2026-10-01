"use client"
import { Button } from "@/components/ui/button"
/** Agent and playground callers share the same RFC2833 controls. */
export function DtmfKeypad({
  disabled,
  send,
  label = "DTMF keypad",
}: {
  disabled: boolean
  send: (digit: string) => void
  label?: string
}) {
  return (
    <div className="grid max-w-xs grid-cols-3 gap-2" aria-label={label}>
      {"123456789*0#".split("").map((digit) => (
        <Button
          key={digit}
          variant="outline"
          disabled={disabled}
          aria-label={`Send ${digit}`}
          onClick={() => send(digit)}
        >
          {digit}
        </Button>
      ))}
    </div>
  )
}
