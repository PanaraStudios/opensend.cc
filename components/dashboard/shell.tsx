"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  BookOpenIcon,
  ChevronsUpDownIcon,
  GlobeIcon,
  KeyRoundIcon,
  LayersIcon,
  LogOutIcon,
  MailsIcon,
  MegaphoneIcon,
  RotateCcwIcon,
  ScrollTextIcon,
  SearchIcon,
  SettingsIcon,
  TagIcon,
  UsersIcon,
  WebhookIcon,
} from "lucide-react"

import { Logo, LogoMark } from "@/components/logo"
import { ThemeToggle } from "@/components/theme-toggle"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
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
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/toast"
import { DASHBOARD_NAV, pathMatches, SETTINGS_NAV } from "@/lib/dashboard/nav"
import { initials } from "@/lib/dashboard/format"
import { DashboardProvider, useDashboard } from "@/lib/dashboard/store"
import { cn } from "@/lib/utils"

const ICONS = {
  mails: MailsIcon,
  megaphone: MegaphoneIcon,
  users: UsersIcon,
  layers: LayersIcon,
  tag: TagIcon,
  globe: GlobeIcon,
  key: KeyRoundIcon,
  scroll: ScrollTextIcon,
  webhook: WebhookIcon,
} as const

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
        <CommandInput placeholder="Search pages, domains, contacts…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Pages">
            {DASHBOARD_NAV.flatMap((group) => group.items).map((item) => (
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
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

function WorkspaceSwitcher() {
  const { state, resetDemo } = useDashboard()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <SidebarMenuButton
            size="lg"
            className="h-10 data-open:bg-sidebar-accent"
          />
        }
      >
        <span className="flex size-7 items-center justify-center rounded-lg bg-sidebar-accent text-sidebar-accent-foreground">
          <LogoMark className="size-4" />
        </span>
        <span className="grid min-w-0 flex-1 text-left text-sm leading-tight">
          <span className="truncate font-medium">{state.settings.teamName}</span>
          <span className="truncate text-xs text-muted-foreground">
            {state.settings.teamSlug}
          </span>
        </span>
        <ChevronsUpDownIcon className="ml-auto size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Workspace</DropdownMenuLabel>
        <DropdownMenuItem disabled>
          <LogoMark className="size-4" />
          {state.settings.teamName}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/settings" />}>
          <SettingsIcon />
          Workspace settings
        </DropdownMenuItem>
        <DropdownMenuItem onClick={resetDemo}>
          <RotateCcwIcon />
          Reset demo data
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DashboardSidebar({
  onSearch,
}: {
  onSearch: () => void
}) {
  const pathname = usePathname()
  const { state } = useDashboard()
  const you = state.members.find((member) => member.you)

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <WorkspaceSwitcher />
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={onSearch} tooltip="Search">
              <SearchIcon />
              <span>Search</span>
              <Kbd className="ml-auto group-data-[collapsible=icon]:hidden">
                ⌘K
              </Kbd>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {DASHBOARD_NAV.map((group) => (
          <SidebarGroup key={group.label ?? "main"}>
            {group.label ? (
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            ) : null}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const Icon = ICONS[item.icon]
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        isActive={pathMatches(pathname, item.href)}
                        tooltip={item.title}
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
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={pathname.startsWith("/settings")}
              tooltip="Settings"
              render={<Link href="/settings" />}
            >
              <SettingsIcon />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Docs"
              render={
                <Link href="/docs" target="_blank" rel="noreferrer" />
              }
            >
              <BookOpenIcon />
              <span>Docs</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    size="lg"
                    className="h-11 data-open:bg-sidebar-accent"
                  />
                }
              >
                <Avatar size="sm">
                  <AvatarFallback>{initials(you?.name ?? "You")}</AvatarFallback>
                </Avatar>
                <span className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">
                    {you?.name ?? "You"}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {you?.email}
                  </span>
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="w-56">
                <DropdownMenuLabel>Account</DropdownMenuLabel>
                <DropdownMenuItem render={<Link href="/settings" />}>
                  <SettingsIcon />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuItem render={<Link href="/" />}>
                  <LogOutIcon />
                  Back to site
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function DashboardChrome({ children }: { children: React.ReactNode }) {
  const [searchOpen, setSearchOpen] = React.useState(false)
  const pathname = usePathname()

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
    <SidebarProvider>
      <DashboardSidebar onSearch={() => setSearchOpen(true)} />
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
          <SidebarTrigger className="-ml-1" />
          <Button
            variant="outline"
            size="sm"
            className="hidden min-w-48 justify-start text-muted-foreground md:inline-flex"
            onClick={() => setSearchOpen(true)}
          >
            <SearchIcon />
            Search
            <Kbd className="ml-auto">⌘K</Kbd>
          </Button>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon-sm"
              nativeButton={false}
              className="md:hidden"
              render={<Link href="/" />}
              aria-label="Marketing site"
            >
              <Logo variant="mark" />
            </Button>
          </div>
        </header>
        <div
          className={cn(
            "flex flex-1 flex-col",
            pathname.startsWith("/settings")
              ? "min-h-0"
              : "gap-6 p-6 md:p-8"
          )}
        >
          {children}
        </div>
      </SidebarInset>
      <CommandMenu open={searchOpen} onOpenChange={setSearchOpen} />
    </SidebarProvider>
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
