import {
  ArchiveRestoreIcon,
  ArrowUpRightIcon,
  ContainerIcon,
  GlobeIcon,
  SendIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react"

import { Reveal, Stagger, StaggerItem } from "@/components/marketing/motion"
import { SectionHeader } from "@/components/marketing/section-header"
import { StackLogoMark } from "@/components/marketing/stack-logos"
import { SELF_HOST } from "@/content/landing"

const ICONS: Record<string, LucideIcon> = {
  "archive-restore": ArchiveRestoreIcon,
  container: ContainerIcon,
  users: UsersIcon,
  globe: GlobeIcon,
  send: SendIcon,
}

/* The differentiator: centered header, then two matching .frame + .panel
   cards side by side. Left, the stack one deploy sets up, one brand mark
   per layer with a hairline connector running down through the tiles.
   Right, the setup steps in order, each with an arrow tile. The guide link
   closes the section as one link line. */
export function SelfHosting() {
  return (
    <section id="self-host" className="section scroll-mt-16 px-6 md:px-10">
      <SectionHeader
        title={
          <>
            {SELF_HOST.titleA} <em>{SELF_HOST.titleEm}</em>
          </>
        }
        description={SELF_HOST.sub}
      />
      <Stagger className="mx-auto mt-14 grid min-w-0 max-w-4xl gap-6 lg:grid-cols-2">
        <Panel title={SELF_HOST.stack.title}>
          <ol className="relative">
            <span
              aria-hidden="true"
              className="absolute top-5 bottom-5 left-[18px] w-px bg-border"
            />
            {SELF_HOST.stack.layers.map((layer) => {
              const Icon = layer.icon ? ICONS[layer.icon] : null
              return (
                <li
                  key={layer.label}
                  className="relative flex items-center gap-3 py-2.5"
                >
                  <span className="icon-tile size-9 [&_svg]:size-4">
                    {Icon ? (
                      <Icon strokeWidth={1.5} />
                    ) : layer.logo ? (
                      <StackLogoMark
                        logo={{ id: layer.logo, name: layer.label }}
                        className="size-[18px]"
                      />
                    ) : null}
                  </span>
                  <span className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
                    <span className="min-w-0 text-small font-medium">
                      {layer.label}
                    </span>
                    <span className="shrink-0 text-caption font-normal text-faint-foreground max-sm:hidden">
                      {layer.note}
                    </span>
                  </span>
                </li>
              )
            })}
          </ol>
        </Panel>
        <Panel title={SELF_HOST.guide.title}>
          <ol>
            {SELF_HOST.guide.steps.map((step, i) => {
              const Icon = ICONS[step.icon]
              return (
                <li key={step.label} className="flex items-center gap-3 py-2.5">
                  <span className="icon-tile size-9 [&_svg]:size-4">
                    {Icon ? <Icon strokeWidth={1.5} /> : null}
                  </span>
                  <span className="flex min-w-0 flex-1 items-baseline gap-3">
                    <span className="shrink-0 font-mono text-caption font-normal text-faint-foreground">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 text-small font-medium text-pretty">
                      {step.label}
                    </span>
                  </span>
                </li>
              )
            })}
          </ol>
        </Panel>
      </Stagger>
      <Reveal className="mt-10 flex flex-col items-center gap-1 text-center">
        <a
          href={SELF_HOST.offer.href}
          {...(SELF_HOST.offer.href.startsWith("http")
            ? { target: "_blank", rel: "noreferrer" }
            : {})}
          data-umami-event="guide_click"
          className="inline-flex items-center gap-1 text-small font-medium text-primary hover:text-primary-hover"
        >
          {SELF_HOST.offer.label}
          <ArrowUpRightIcon className="size-3.5" />
        </a>
        <p className="text-caption font-normal text-faint-foreground">
          {SELF_HOST.offer.note}
        </p>
      </Reveal>
    </section>
  )
}

/* The shared card shell with a caption row on top. */
function Panel({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <StaggerItem className="frame">
      <div className="panel flex h-full flex-col gap-3 p-5">
        <p className="text-caption text-muted-foreground">{title}</p>
        {children}
      </div>
    </StaggerItem>
  )
}
