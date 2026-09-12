import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { ImageResponse } from "next/og"

import {
  LOGO_MARK_BOWL,
  LOGO_MARK_STROKE,
  LOGO_MARK_TAIL,
} from "@/components/logo"
import { SITE } from "@/content/site"

/* Link preview for every route (a deeper opengraph-image.tsx would win over
   this one). Rendered once at build with Satori, so only flexbox and the CSS
   it supports are used here: no grid, no CSS variables, no Tailwind.

   Same language as the hero: light page, dot grid fading out from the top,
   wordmark, headline with the accent phrase, one line of sub copy. The
   fonts are static TTF cuts of two of the faces loaded in app/layout.tsx;
   Satori cannot read variable fonts or woff2. */

export const alt = SITE.og.alt
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

const bg = "#fafafa"
const fg = "#0a0a0a"
const fgMuted = "#737373"
const border = "#d4d4d4"
const brand = "#a3a3a3"

function font(file: string) {
  return readFile(join(process.cwd(), "assets/fonts", file))
}

export default async function Image() {
  const [sans, sansBold, mono] = await Promise.all([
    font("BricolageGrotesque-Regular.ttf"),
    font("BricolageGrotesque-SemiBold.ttf"),
    font("GeistMono-Medium.ttf"),
  ])

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: bg,
          color: fg,
          fontFamily: "Bricolage Grotesque",
        }}
      >
        {/* Dot grid, then a wash that fades it out toward the bottom so the
            headline sits on clean ground. */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            backgroundImage: `radial-gradient(${border} 2px, transparent 2px)`,
            backgroundSize: "18px 18px",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            backgroundImage: `linear-gradient(to bottom, rgba(250,250,250,0.2) 0%, ${bg} 58%)`,
          }}
        />

        {/* Lockup: @ mark + opensend.cc, same as components/logo.tsx. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontSize: 40,
            fontWeight: 600,
            letterSpacing: "-0.025em",
          }}
        >
          <svg
            width="48"
            height="48"
            viewBox="0 0 32 32"
            fill="none"
          >
            <circle
              cx={LOGO_MARK_BOWL.cx}
              cy={LOGO_MARK_BOWL.cy}
              r={LOGO_MARK_BOWL.r}
              stroke={fg}
              strokeWidth={LOGO_MARK_STROKE}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={LOGO_MARK_TAIL}
              stroke={fg}
              strokeWidth={LOGO_MARK_STROKE}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>opensend.cc</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 92,
              fontWeight: 600,
              lineHeight: 1.02,
              letterSpacing: "-0.035em",
            }}
          >
            <span>{SITE.og.titleA}</span>
            <span style={{ color: brand }}>{SITE.og.titleEm}</span>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              fontSize: 30,
              lineHeight: 1.3,
              color: fgMuted,
            }}
          >
            {SITE.og.sub.map((line) => (
              <div
                key={line}
                style={{ display: "flex", fontWeight: 600 }}
              >
                {line}
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontFamily: "Geist Mono",
            fontSize: 22,
            color: fgMuted,
          }}
        >
          <span>{SITE.url.replace("https://", "")}</span>
          <span>Resend alternative · Self-hosted</span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Bricolage Grotesque", data: sans, weight: 400, style: "normal" },
        { name: "Bricolage Grotesque", data: sansBold, weight: 600, style: "normal" },
        { name: "Geist Mono", data: mono, weight: 500, style: "normal" },
      ],
    }
  )
}
