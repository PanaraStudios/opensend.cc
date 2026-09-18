"use client"

import { useState } from "react"
import { ArrowRightIcon, ArrowUpRightIcon, PlusIcon } from "lucide-react"

import { SponsorMark } from "@/components/marketing/sponsor-wall"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  SPONSOR_CATEGORIES,
  SPONSOR_MAILTO,
  SPONSORS,
  SPONSORS_PAGE,
  type SponsorCategory,
} from "@/content/landing"

type Filter = "all" | SponsorCategory

/* Filter chips plus the sponsor list. Open slots stay visible on All so
   there is always a row you can buy. Category filters hide them. */

export function SponsorDirectory() {
  const [filter, setFilter] = useState<Filter>("all")
  const copy = SPONSORS_PAGE.directory
  const sponsors =
    filter === "all"
      ? SPONSORS.items
      : SPONSORS.items.filter((item) => item.category === filter)
  const showOpen = filter === "all"

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap gap-2">
        <FilterChip
          label={copy.allFilter}
          pressed={filter === "all"}
          onClick={() => setFilter("all")}
        />
        {SPONSOR_CATEGORIES.map((category) => (
          <FilterChip
            key={category}
            label={category}
            pressed={filter === category}
            onClick={() => setFilter(category)}
          />
        ))}
      </div>
      {sponsors.length === 0 && !showOpen ? (
        <Empty className="border border-dashed border-border py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PlusIcon />
            </EmptyMedia>
            <EmptyTitle>{copy.openName}</EmptyTitle>
            <EmptyDescription>{copy.emptyFilter}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              size="sm"
              nativeButton={false}
              render={
                <a
                  href={SPONSOR_MAILTO}
                  data-umami-event="sponsor_cta"
                  data-umami-event-section="directory-empty"
                />
              }
            >
              {copy.openAction}
              <ArrowRightIcon />
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="max-md:hidden">Category</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">Action</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {showOpen ? <OpenRow /> : null}
            {sponsors.map((sponsor) => (
              <TableRow key={sponsor.name}>
                <TableCell>
                  <a
                    href={sponsor.href}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-3"
                  >
                    <span className="icon-tile size-8 [&_svg]:size-4">
                      <SponsorMark sponsor={sponsor} className="h-4 max-w-6" />
                    </span>
                    <span className="font-medium">{sponsor.name}</span>
                  </a>
                </TableCell>
                <TableCell>
                  <Badge variant="soft">{copy.partnerStatus}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground max-md:hidden">
                  {sponsor.category}
                </TableCell>
                <TableCell className="text-right">
                  <a
                    href={sponsor.href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-small text-primary hover:text-primary-hover"
                  >
                    {copy.visitAction}
                    <ArrowUpRightIcon className="size-3.5 shrink-0" />
                  </a>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

function FilterChip({
  label,
  pressed,
  onClick,
}: {
  label: string
  pressed: boolean
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={pressed ? "default" : "outline"}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {label}
    </Button>
  )
}

function OpenRow() {
  const copy = SPONSORS_PAGE.directory
  return (
    <TableRow>
      <TableCell>
        <span className="flex items-center gap-3">
          <span className="icon-tile size-8 [&_svg]:size-4">
            <PlusIcon strokeWidth={1.5} />
          </span>
          <span className="font-medium">{copy.openName}</span>
        </span>
      </TableCell>
      <TableCell>
        <Badge variant="success">{copy.openStatus}</Badge>
      </TableCell>
      <TableCell className="text-muted-foreground max-md:hidden">—</TableCell>
      <TableCell className="text-right">
        <a
          href={SPONSOR_MAILTO}
          className="inline-flex items-center gap-1 text-small font-medium text-primary hover:text-primary-hover"
          data-umami-event="sponsor_cta"
          data-umami-event-section="directory"
        >
          {copy.openAction}
          <ArrowRightIcon className="size-3.5 shrink-0" />
        </a>
      </TableCell>
    </TableRow>
  )
}
