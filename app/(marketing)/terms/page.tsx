import type { Metadata } from "next"

import { LegalPage, LegalSection } from "@/components/marketing/legal-page"
import { PAGES } from "@/content/site"
import { pageMetadata } from "@/lib/seo"

export const metadata: Metadata = pageMetadata(PAGES.terms)

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="September 12, 2026">
      <LegalSection title="The software">
        <p>
          opensend.cc is open source software under the Apache License 2.0. The
          license, not this page, governs what you can do with the code. See
          the LICENSE file in the repository.
        </p>
      </LegalSection>
      <LegalSection title="Self-hosting">
        <p>
          You run opensend.cc on your own infrastructure. You are responsible
          for how you use it. That includes the email you send, the laws that
          apply to it, and the reputation of your domains. Those laws include
          anti-spam, consent and data protection.
        </p>
        <p>
          Do not use opensend.cc to send unsolicited bulk email. Recipients must
          have opted in.
        </p>
      </LegalSection>
      <LegalSection title="This website">
        <p>
          The content on opensend.cc is provided as is. Links to third-party
          services are governed by their own terms. That includes GitHub, AWS
          and relay providers.
        </p>
      </LegalSection>
      <LegalSection title="No warranty">
        <p>
          We provide the software and this site as is. We are not liable for
          damages from using opensend.cc in your products or on your
          infrastructure.
        </p>
      </LegalSection>
      <LegalSection title="Changes">
        <p>
          We may update these terms as the project changes. Material changes
          are noted in the repository. Send questions to hello@opensend.cc.
        </p>
      </LegalSection>
      <LegalSection title="Operator">
        <p>
          This website and the opensend.cc project are operated by{" "}
          <a
            href="https://panarastudios.in"
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:text-primary-hover"
          >
            Panara Studios
          </a>
          . Product mail goes to hello@opensend.cc.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
