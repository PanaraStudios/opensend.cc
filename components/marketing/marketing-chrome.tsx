import { MotionProvider } from "@/components/marketing/motion"
import { SiteFooter } from "@/components/marketing/site-footer"
import { SiteHeader } from "@/components/marketing/site-header"

/* Hatch, rails, header, and footer. Used by the marketing layout and by
   status pages that sit outside that layout (root 404, global 500). */
export function MarketingChrome({ children }: { children: React.ReactNode }) {
  return (
    <MotionProvider>
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
