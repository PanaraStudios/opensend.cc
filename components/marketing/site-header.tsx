"use client"

import { MenuIcon, XIcon } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import Link from "next/link"
import { useState } from "react"

import { Logo } from "@/components/logo"
import { GitHubIcon } from "@/components/marketing/github-icon"
import { ThemeToggle } from "@/components/marketing/theme-toggle"
import { Button } from "@/components/ui/button"
import { NAV } from "@/content/landing"

/* Marketing nav: sticky 56px bar inside the rails, 1px bottom border. Mark
   left, links center, theme toggle + GitHub right. Slides down 12px on
   load. On mobile the links collapse into a hamburger panel that opens and
   closes by height; GitHub stays visible. */
export function SiteHeader() {
  const [open, setOpen] = useState(false)

  return (
    <motion.header
      initial={{ y: -12, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="corners-b sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md"
    >
      <div className="flex h-14 items-center justify-between px-6 md:px-10">
        <Link
          href="/"
          aria-label="opensend.cc home"
          className="w-fit"
          onClick={() => setOpen(false)}
        >
          <Logo variant="full" className="text-base" />
        </Link>
        <nav className="hidden items-center gap-4 md:flex lg:gap-6">
          {NAV.links.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-small text-muted-foreground hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button
            size="sm"
            nativeButton={false}
            render={
              <a
                href={NAV.github.href}
                target="_blank"
                rel="noreferrer"
                data-umami-event="cta_click"
                data-umami-event-section="nav"
              />
            }
          >
            <GitHubIcon />
            {NAV.github.label}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <XIcon /> : <MenuIcon />}
          </Button>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.nav
            key="menu"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-t border-border md:hidden"
          >
            <div className="flex flex-col gap-1 px-6 py-4">
              {NAV.links.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="rounded-md px-2 py-2 text-small text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </motion.nav>
        ) : null}
      </AnimatePresence>
    </motion.header>
  )
}
