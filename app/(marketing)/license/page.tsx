import type { Metadata } from "next"

import { LegalPage, LegalSection } from "@/components/marketing/legal-page"
import { GITHUB_URL } from "@/content/landing"
import { PAGES } from "@/content/site"
import { pageMetadata } from "@/lib/seo"

export const metadata: Metadata = pageMetadata(PAGES.license)

export default function LicensePage() {
  return (
    <LegalPage title="License" updated="September 12, 2026">
      <LegalSection title="Open source">
        <p>
          opensend.cc is open source under the Apache License 2.0. The full text
          is in the{" "}
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:text-primary-hover"
          >
            LICENSE
          </a>{" "}
          file in the repository.
        </p>
        <p>
          No subscription, no per-email pricing, no feature gates. Self-host the
          Resend-compatible API on Next.js, Convex, Better Auth and AWS SES. The
          code you run stays yours.
        </p>
      </LegalSection>
      <LegalSection title="What you can do">
        <p>
          Use opensend.cc for anything: your own products, your clients&apos;
          work, commercial or otherwise. Modify it and deploy it to as many
          servers as you like.
        </p>
      </LegalSection>
      <LegalSection title="What the license asks">
        <p>
          Keep the copyright and license notices with the code. Mark changes you
          make. That is the whole obligation.
        </p>
      </LegalSection>
      <LegalSection title="No warranty">
        <p>
          opensend.cc is provided as is, without warranties of any kind. You run
          it on your own infrastructure. Its operation and its email
          deliverability are your responsibility.
        </p>
      </LegalSection>
      <LegalSection title="Operator">
        <p>
          opensend.cc is a product of{" "}
          <a
            href="https://panarastudios.in"
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:text-primary-hover"
          >
            Panara Studios
          </a>
          . Questions: hello@opensend.cc.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
