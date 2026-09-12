import { JsonLd } from "@/components/json-ld"
import { MotionProvider } from "@/components/marketing/motion"
import { SiteFooter } from "@/components/marketing/site-footer"
import { SiteHeader } from "@/components/marketing/site-header"
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
    <MotionProvider>
      <JsonLd data={siteJsonLd()} />
      <div className="hatch">
        <div className="rails flex min-h-svh flex-col">
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </div>
      </div>
    </MotionProvider>
  )
}
