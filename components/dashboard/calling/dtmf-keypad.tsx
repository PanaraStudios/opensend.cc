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
          className="h-14"
          disabled={disabled}
          aria-label={`Send ${digit}`}
          onClick={() => send(digit)}
        >
          <span className="flex flex-col items-center">
            <span className="text-lg">{digit}</span>
            <span className="h-3 text-[9px] text-muted-foreground">
              {
                (
                  {
                    "2": "ABC",
                    "3": "DEF",
                    "4": "GHI",
                    "5": "JKL",
                    "6": "MNO",
                    "7": "PQRS",
                    "8": "TUV",
                    "9": "WXYZ",
                    "0": "+",
                  } as Record<string, string>
                )[digit]
              }
            </span>
          </span>
        </Button>
      ))}
    </div>
  )
}
