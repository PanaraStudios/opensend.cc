import { JsonLd } from "@/components/json-ld"
import { MarketingChrome } from "@/components/marketing/marketing-chrome"
import { siteJsonLd } from "@/lib/schema"

/* Marketing chrome: the bounded rails column with sticky header on top and
   the footer closing the column, over hatched gutters on wide screens. Auth
   pages keep their own split layout. MotionProvider applies the
   reduced-motion preference to every animation below it. */
export default function MarketingLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <MarketingChrome>
      <JsonLd data={siteJsonLd()} />
      {children}
    </MarketingChrome>
  )
}
