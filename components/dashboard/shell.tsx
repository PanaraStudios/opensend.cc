"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  ArrowUpRightIcon,
  BookOpenIcon,
  HouseIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SearchIcon,
  SunIcon,
  UserRoundIcon,
} from "lucide-react"
import { useTheme } from "next-themes"

import { ConfirmDialog } from "@/components/dashboard/primitives"
import { TeamSwitcher } from "@/components/dashboard/team-switcher"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Kbd } from "@/components/ui/kbd"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/toast"
import { DASHBOARD_NAV, navItemActive, SETTINGS_NAV } from "@/lib/dashboard/nav"
import { initials } from "@/lib/dashboard/format"
import { DashboardProvider, useDashboard } from "@/lib/dashboard/store"

const APPEARANCE_OPTIONS = [
  { theme: "light", label: "Light", Icon: SunIcon },
  { theme: "dark", label: "Dark", Icon: MoonIcon },
  { theme: "system", label: "System", Icon: MonitorIcon },
] as const

/* Menu radio items so arrow keys, Enter, and assistive tech all reach them.
   The menu stays open so the change is visible before it closes. */
function AppearanceItems() {
  const { theme, setTheme } = useTheme()

  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>Appearance</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={theme ?? ""}
        onValueChange={(next) => setTheme(String(next))}
      >
        {APPEARANCE_OPTIONS.map(({ theme: value, label, Icon }) => (
          <DropdownMenuRadioItem key={value} value={value} closeOnClick={false}>
            <Icon />
            {label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuGroup>
  )
}

function SidebarCollapseButton() {
  const { state, toggleSidebar } = useSidebar()
  const collapsed = state === "collapsed"

  return (
    <SidebarMenuButton
      tooltip={collapsed ? "Expand" : "Collapse"}
      onClick={toggleSidebar}
    >
      {collapsed ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
      <span>{collapsed ? "Expand" : "Collapse"}</span>
    </SidebarMenuButton>
  )
}

function CommandMenu({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const { state } = useDashboard()

  function go(href: string) {
    onOpenChange(false)
    router.push(href)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      description="Jump to a page or record"
    >
      <Command>
        <CommandInput placeholder="Search pages, emails, contacts…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Pages">
            {DASHBOARD_NAV.map((item) => (
              <CommandItem
                key={item.href}
                value={item.title}
                onSelect={() => go(item.href)}
              >
                {item.title}
              </CommandItem>
            ))}
            {SETTINGS_NAV.map((item) => (
              <CommandItem
                key={item.href}
                value={`Settings ${item.title}`}
                onSelect={() => go(item.href)}
              >
                Settings · {item.title}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          {open ? (
            <>
              <CommandGroup heading="Emails">
                {state.emails.map((email) => (
                  <CommandItem
                    key={email.id}
                    value={`email ${email.subject} ${email.to}`}
                    onSelect={() => go(`/emails/${email.id}`)}
                  >
                    {email.subject}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup heading="Domains">
                {state.domains.map((domain) => (
                  <CommandItem
                    key={domain.id}
                    value={`domain ${domain.name}`}
                    onSelect={() => go(`/domains/${domain.id}`)}
                  >
                    {domain.name}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup heading="Contacts">
                {state.contacts.map((contact) => (
                  <CommandItem
                    key={contact.id}
                    value={`contact ${contact.email} ${contact.firstName} ${contact.lastName}`}
                    onSelect={() => go(`/contacts/${contact.id}`)}
                  >
                    {contact.email}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

function DashboardSidebar({ onSearch }: { onSearch: () => void }) {
  const pathname = usePathname()
  const router = useRouter()
  const { you, resetDemo } = useDashboard()
  const [logoutOpen, setLogoutOpen] = React.useState(false)

  return (
    <Sidebar
      collapsible="icon"
      className="bg-background/90 border-double-r backdrop-blur-md"
    >
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <TeamSwitcher />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem className="mb-1">
                <SidebarMenuButton
                  variant="outline"
                  tooltip="Search"
                  onClick={onSearch}
                >
                  <SearchIcon />
                  <span>Search</span>
                  <Kbd className="ml-auto px-1.5 group-data-[collapsible=icon]:hidden">
                    <span>⌘</span>
                    <span>K</span>
                  </Kbd>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {DASHBOARD_NAV.map((item) => {
                const Icon = item.icon
                const active = navItemActive(pathname, item)
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={active}
                      tooltip={item.title}
                      aria-current={active ? "page" : undefined}
                      render={<Link href={item.href} />}
                    >
                      <Icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarCollapseButton />
          </SidebarMenuItem>
          <SidebarMenuItem className="flex w-full flex-row items-center justify-between group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:justify-start group-data-[collapsible=icon]:gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    size="icon"
                    tooltip={you?.name ?? "Account"}
                    className="overflow-hidden rounded-full"
                  />
                }
              >
                <Avatar>
                  <AvatarFallback>
                    {initials(you?.name ?? "You")}
                  </AvatarFallback>
                </Avatar>
                <span className="sr-only">{you?.name ?? "Account"}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="p-0 font-normal text-foreground">
                    <span className="flex items-center gap-2 px-1.5 py-1.5">
                      <Avatar size="sm">
                        <AvatarFallback>
                          {initials(you?.name ?? "You")}
                        </AvatarFallback>
                      </Avatar>
                      <span className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                        <span className="truncate font-medium">
                          {you?.name ?? "You"}
                        </span>
                        <span className="truncate font-mono text-caption text-muted-foreground">
                          {you?.email}
                        </span>
                      </span>
                    </span>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem render={<Link href="/profile" />}>
                    <UserRoundIcon />
                    My profile
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <AppearanceItems />
                <DropdownMenuSeparator />
                <DropdownMenuItem render={<Link href="/" />}>
                  <HouseIcon />
                  Homepage
                  <ArrowUpRightIcon className="ml-auto" />
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setLogoutOpen(true)}
                >
                  <LogOutIcon />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <SidebarMenuButton
              size="icon"
              tooltip="Docs"
              render={<Link href="/docs" target="_blank" rel="noreferrer" />}
            >
              <BookOpenIcon />
              <span className="sr-only">Docs</span>
            </SidebarMenuButton>
            <ConfirmDialog
              open={logoutOpen}
              onOpenChange={setLogoutOpen}
              title="Log out?"
              description="You'll leave this demo workspace and go to the waitlist."
              confirmLabel="Log out"
              onConfirm={() => {
                resetDemo()
                router.push("/waitlist")
              }}
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function DashboardChrome({ children }: { children: React.ReactNode }) {
  const [searchOpen, setSearchOpen] = React.useState(false)

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setSearchOpen((open) => !open)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  return (
    <div className="hatch min-h-svh">
      <SidebarProvider>
        <DashboardSidebar onSearch={() => setSearchOpen(true)} />
        <SidebarInset className="min-w-0 bg-background">
          <div className="flex min-h-0 w-full flex-1 flex-col gap-6 px-6 py-8 md:px-10">
            <SidebarTrigger className="-ml-1 md:hidden" />
            {children}
          </div>
        </SidebarInset>
        <CommandMenu open={searchOpen} onOpenChange={setSearchOpen} />
      </SidebarProvider>
    </div>
  )
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <DashboardProvider>
      <Toaster>
        <DashboardChrome>{children}</DashboardChrome>
      </Toaster>
    </DashboardProvider>
  )
}

/** The same workspace store and toasts without the sidebar, for full-screen
    editors that own the whole viewport. */
export function FullScreenShell({ children }: { children: React.ReactNode }) {
  return (
    <DashboardProvider>
      <Toaster>{children}</Toaster>
    </DashboardProvider>
  )
}
