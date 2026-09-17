"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import type { DateRange } from "react-day-picker"

import { Button } from "@/components/ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageHeader } from "@/components/dashboard/primitives"
import {
  DateRangePicker,
  ToolbarSelect,
  type SelectOption,
} from "@/components/dashboard/emails/shared"
import {
  ArrowLeftIcon,
  BookOpenIcon,
  DownloadIcon,
  SearchIcon,
  type LucideIcon,
} from "lucide-react"
import { AUDIENCE_TABS, tabActive } from "@/lib/dashboard/nav"

export const SUBSCRIBED_ITEMS = [
  { value: "all", label: "All contacts" },
  { value: "subscribed", label: "Subscribed" },
  { value: "unsubscribed", label: "Unsubscribed" },
] as const

export function AudienceChrome({
  actions,
  children,
}: {
  actions?: React.ReactNode
  children?: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const value =
    AUDIENCE_TABS.find((tab) => tabActive(pathname, tab.href))?.href ??
    AUDIENCE_TABS[0].href

  return (
    <>
      <PageHeader title="Audience">{actions}</PageHeader>
      <Tabs
        value={value}
        onValueChange={(next) => {
          if (next) router.push(next)
        }}
      >
        <TabsList>
          {AUDIENCE_TABS.map((tab) => (
            <TabsTrigger key={tab.href} value={tab.href}>
              {tab.title}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {children}
    </>
  )
}

export function AudienceToolbar({
  query,
  onQueryChange,
  placeholder,
  range,
  onRangeChange,
  select,
  extraSelect,
  onExport,
}: {
  query: string
  onQueryChange: (value: string) => void
  placeholder: string
  range?: DateRange | undefined
  onRangeChange?: (range: DateRange | undefined) => void
  select?: {
    value: string
    onChange: (value: string) => void
    items: readonly SelectOption[]
    "aria-label": string
  }
  extraSelect?: {
    value: string
    onChange: (value: string) => void
    items: readonly SelectOption[]
    "aria-label": string
  }
  onExport?: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <InputGroup className="h-8! max-w-xs overflow-hidden">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          className="h-full! min-w-0"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={placeholder}
        />
      </InputGroup>
      {onRangeChange ? (
        <DateRangePicker
          range={range}
          onRangeChange={onRangeChange}
          allowAllTime
        />
      ) : null}
      {select ? (
        <ToolbarSelect
          value={select.value}
          onChange={select.onChange}
          items={select.items}
          aria-label={select["aria-label"]}
        />
      ) : null}
      {extraSelect ? (
        <ToolbarSelect
          value={extraSelect.value}
          onChange={extraSelect.onChange}
          items={extraSelect.items}
          aria-label={extraSelect["aria-label"]}
        />
      ) : null}
      {onExport ? (
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Export"
          className="ml-auto"
          onClick={onExport}
        >
          <DownloadIcon />
        </Button>
      ) : null}
    </div>
  )
}

export function AudienceDocsButton({
  onClick,
}: {
  onClick: () => void
}) {
  return (
    <Button variant="outline" onClick={onClick}>
      <BookOpenIcon data-icon="inline-start" />
      Docs
    </Button>
  )
}

export function AudienceDocsSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Audience</SheetTitle>
          <SheetDescription>
            Contacts, properties, segments, and topics share this section.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-4 text-sm">
          <div className="flex flex-col gap-1">
            <p className="font-medium">Contacts</p>
            <p className="text-muted-foreground">
              Global addresses for broadcasts. Add them manually, import a CSV,
              then assign segments and topics.
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="font-medium">Properties</p>
            <p className="text-muted-foreground">
              Custom fields plus the reserved email, first_name, last_name, and
              unsubscribed keys. Use fallbacks when a contact has no value.
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="font-medium">Segments</p>
            <p className="text-muted-foreground">
              Internal groups for targeting. Contacts never see segment names.
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="font-medium">Topics</p>
            <p className="text-muted-foreground">
              Preference categories on the unsubscribe page. Scope a broadcast
              so contacts can leave one list without leaving all of them.
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function AudienceDetailHeader({
  backHref,
  backLabel,
  title,
  icon: Icon,
  description,
  actions,
}: {
  backHref: string
  backLabel: string
  title: string
  icon: LucideIcon
  description?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-4">
      <Button
        variant="ghost"
        size="sm"
        nativeButton={false}
        className="-ml-2 w-fit text-muted-foreground"
        render={<Link href={backHref} />}
      >
        <ArrowLeftIcon data-icon="inline-start" />
        {backLabel}
      </Button>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="icon-tile">
            <Icon />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="title-gradient text-h3 break-all">{title}</h1>
            {description ? (
              <p className="text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function propertyDisplayName(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
}
