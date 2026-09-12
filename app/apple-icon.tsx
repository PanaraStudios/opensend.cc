import { ImageResponse } from "next/og"

import {
  LOGO_MARK_BOWL,
  LOGO_MARK_STROKE,
  LOGO_MARK_TAIL,
} from "@/components/logo"

/* 180×180 PNG for iOS home screens and as Organization.logo in JSON-LD.
   Matches app/icon.svg: dark rounded square, white @ mark. */

export const size = { width: 180, height: 180 }
export const contentType = "image/png"

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#171717",
          borderRadius: 40,
        }}
      >
        <svg
          width="118"
          height="118"
          viewBox="0 0 32 32"
          fill="none"
        >
          <circle
            cx={LOGO_MARK_BOWL.cx}
            cy={LOGO_MARK_BOWL.cy}
            r={LOGO_MARK_BOWL.r}
            stroke="#ffffff"
            strokeWidth={LOGO_MARK_STROKE}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={LOGO_MARK_TAIL}
            stroke="#ffffff"
            strokeWidth={LOGO_MARK_STROKE}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    ),
    { ...size }
  )
}
