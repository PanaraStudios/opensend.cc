import { About } from "./_sections/about"
import { Faq } from "./_sections/faq"
import { FinalCta } from "./_sections/final-cta"
import { Hero } from "./_sections/hero"
import { HowItWorks } from "./_sections/how-it-works"
import { Pricing } from "./_sections/pricing"
import { SelfHosting } from "./_sections/self-hosting"
import { Sponsors } from "./_sections/sponsors"
import { StackStrip } from "./_sections/stack-strip"
import { Testimonials } from "./_sections/testimonials"
import { WhatYouGet } from "./_sections/what-you-get"
import { JsonLd } from "@/components/json-ld"
import { TESTIMONIALS } from "@/content/landing"
import { homeJsonLd } from "@/lib/schema"

/* Landing page: one column, sections separated by 1px rules. All copy lives
   in content/landing.ts. Testimonials stay off the page until
   TESTIMONIALS.live is true (real quotes only). */
export default function Page() {
  return (
    <>
      <JsonLd data={homeJsonLd()} />
      <Hero />
      <StackStrip />
      <WhatYouGet />
      <SelfHosting />
      <HowItWorks />
      <About />
      <Sponsors />
      {TESTIMONIALS.live && <Testimonials />}
      <Pricing />
      <Faq />
      <FinalCta />
    </>
  )
}
