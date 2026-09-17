import Link from "next/link"

import { GitHubIcon, XIcon, YouTubeIcon } from "@/components/brand-icons"
import { Reveal } from "@/components/marketing/motion"
import { Logo } from "@/components/logo"
import { FOOTER } from "@/content/landing"

const SOCIAL_ICONS = {
  x: XIcon,
  github: GitHubIcon,
  youtube: YouTubeIcon,
}

const DATAFAST_WIDGET_ID = "6aa5879fc6baa5ba34653f81"

function datafastRecentSrc(theme: "light" | "dark") {
  const params = new URLSearchParams({
    mainTextSize: "12",
    primaryColor: theme === "dark" ? "#fafafa" : "#0a0a0a",
    theme,
  })

  return `https://datafa.st/widgets/${DATAFAST_WIDGET_ID}/recent?${params}`
}

/* DataFast only accepts theme=light|dark on the iframe URL, so both
   embeds sit in the DOM and Tailwind shows the one that matches `.dark`. */
function DataFastRecentWidget({ theme }: { theme: "light" | "dark" }) {
  return (
    <iframe
      src={datafastRecentSrc(theme)}
      className={
        theme === "dark"
          ? "hidden h-[288px] w-full border-0 bg-transparent dark:block"
          : "h-[288px] w-full border-0 bg-transparent dark:hidden"
      }
      frameBorder={0}
      title="DataFast Widget"
      loading="lazy"
    />
  )
}

/* Footer: the brand block plus link columns inside the rails under a 1px
   top border, then the bottom row with the copyright notice and the social
   links. Rises into view as one block. Phones stack everything; tablets (sm)
   put the brand block on top and the link groups side by side; md and up is
   the full row. */
export function SiteFooter() {
  return (
    <Reveal>
      <footer>
        <div className="grid gap-10 px-6 py-14 sm:grid-cols-2 md:grid-cols-[1.5fr_repeat(3,1fr)] md:px-10">
          <div className="flex flex-col gap-3 sm:col-span-2 md:col-span-1">
            <Logo variant="full" className="text-lg" />
            <p className="max-w-xs text-small text-muted-foreground">
              {FOOTER.tagline}
            </p>
            <DataFastRecentWidget theme="light" />
            <DataFastRecentWidget theme="dark" />
          </div>
          {FOOTER.columns.map((column) => (
            <div key={column.title} className="flex flex-col gap-3">
              <p className="text-small font-medium">{column.title}</p>
              <ul className="flex flex-col gap-2">
                {column.links.map((link) => (
                  <li key={link.label}>
                    {link.href ? (
                      <Link
                        href={link.href}
                        className="w-fit text-small text-muted-foreground hover:text-foreground"
                      >
                        {link.label}
                      </Link>
                    ) : (
                      <span className="text-small text-faint-foreground">
                        {link.label}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="corners-t relative flex flex-col gap-3 border-t border-border px-6 py-6 sm:flex-row sm:items-center sm:justify-between md:px-10">
          <p className="text-small text-faint-foreground">
            <a
              href={FOOTER.company.href}
              target="_blank"
              rel="noreferrer"
              className="hover:text-foreground"
            >
              {FOOTER.copyright}
            </a>
          </p>
          <div className="flex items-center gap-4">
            {FOOTER.socials.map((social) => {
              const Icon = SOCIAL_ICONS[social.icon]
              return (
                <a
                  key={social.label}
                  href={social.href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={social.label}
                  className="text-faint-foreground hover:text-foreground"
                >
                  <Icon />
                </a>
              )
            })}
          </div>
        </div>
      </footer>
    </Reveal>
  )
}
