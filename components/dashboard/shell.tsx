"use client"

import * as React from "react"
import {
  ShortcutProvider,
  useShortcut,
  useShortcutModifier,
} from "@/lib/dashboard/use-shortcut"
import { NAVIGATION_SHORTCUTS } from "@/lib/dashboard/shortcuts"
import {
  NavigationKeys,
  ShortcutsDialog,
} from "@/components/dashboard/shortcuts-dialog"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { WorkspaceProvider, useWorkspace } from "@/components/auth/workspace"
import { authClient, authResult } from "@/lib/auth/client"
import Link from "next/link"

import { MARKETING_URL } from "@/lib/site"
import { docsHrefForRoute } from "@/lib/docs-links"
import { usePathname, useRouter } from "next/navigation"
import {
  ArrowUpRightIcon,
  ArrowLeftIcon,
  BookOpenIcon,
  HouseIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SearchIcon,
  KeyboardIcon,
  SunIcon,
  UserRoundIcon,
} from "lucide-react"
import { useTheme } from "next-themes"

import {
  ConfirmDialog,
  useDebouncedValue,
} from "@/components/dashboard/primitives"
import { useContactSearch } from "@/lib/audience/use-audience"
import { useEmailSearch } from "@/lib/emails/use-emails"
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
import {
  DASHBOARD_NAV,
  SETTINGS_NAV,
  INSTANCE_PAGES,
  STANDALONE_PAGES,
  navItemActive,
} from "@/lib/dashboard/nav"
import { initials } from "@/lib/dashboard/format"
import { useDomainOptions } from "@/lib/domains/use-domains"

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
  const modifier = useShortcutModifier()
  useShortcut("mod+b", toggleSidebar)

  return (
    <SidebarMenuButton
      aria-keyshortcuts={modifier === "⌘" ? "Meta+B" : "Control+B"}
      tooltip={{
        children: (
          <>
            {collapsed ? "Expand" : "Collapse"}
            <Kbd>{modifier} B</Kbd>
          </>
        ),
      }}
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
  installationAdmin,
  onShortcuts,
}: {
  onShortcuts: () => void
  open: boolean
  onOpenChange: (open: boolean) => void
  installationAdmin: boolean
}) {
  const router = useRouter()
  const [search, setSearch] = React.useState("")
  const settled = useDebouncedValue(search)
  const contacts = useContactSearch(settled, open)
  const emails = useEmailSearch(settled, open)
  const domains = useDomainOptions({ search: settled }, open)

  function setOpen(next: boolean) {
    if (!next) setSearch("")
    onOpenChange(next)
  }
  function go(href: string) {
    setOpen(false)
    router.push(href)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Search"
      description="Jump to a page or record"
    >
      <Command>
        <CommandInput
          placeholder="Search pages, emails, contacts…"
          value={search}
          onValueChange={setSearch}
        />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Pages">
            <CommandItem
              onSelect={() => {
                setOpen(false)
                onShortcuts()
              }}
            >
              Keyboard shortcuts <Kbd className="ml-auto">?</Kbd>
            </CommandItem>
            {DASHBOARD_NAV.map((item) => (
              <CommandItem
                key={item.href}
                value={item.title}
                onSelect={() => go(item.href)}
              >
                {item.title}
                <NavigationKeys href={item.href} />
              </CommandItem>
            ))}
            {/* The first tab is where Settings itself opens, listed above. */}
            {SETTINGS_NAV.slice(1).map((item) => (
              <CommandItem
                key={item.href}
                value={`Settings ${item.title}`}
                onSelect={() => go(item.href)}
              >
                Settings · {item.title}
              </CommandItem>
            ))}
            {STANDALONE_PAGES.map((item) => (
              <CommandItem
                key={item.href}
                value={item.title}
                onSelect={() => go(item.href)}
              >
                {item.title}
              </CommandItem>
            ))}
            {installationAdmin &&
              INSTANCE_PAGES.map((item) => (
                <CommandItem
                  key={item.href}
                  value={item.title}
                  onSelect={() => go(item.href)}
                >
                  {item.title}
                </CommandItem>
              ))}
          </CommandGroup>
          <CommandSeparator />
          {open ? (
            <>
              <CommandGroup heading="Emails">
                {emails.map((email) => (
                  <CommandItem
                    key={email.id}
                    serverResult
                    value={`email ${email.subject} ${email.to}`}
                    onSelect={() => go(`/emails/${email.id}`)}
                  >
                    {email.subject}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup heading="Domains">
                {domains.map((domain) => (
                  <CommandItem
                    key={domain.id}
                    serverResult
                    value={`domain ${domain.name}`}
                    onSelect={() => go(`/domains/${domain.id}`)}
                  >
                    {domain.name}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup heading="Contacts">
                {contacts.map((contact) => (
                  <CommandItem
                    key={contact.id}
                    serverResult
                    value={`contact ${contact.email ?? ""} ${contact.phone ?? ""} ${contact.firstName} ${contact.lastName}`}
                    onSelect={() => go(`/contacts/${contact.id}`)}
                  >
                    {contact.email || contact.phone || "Contact"}
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

function DashboardSidebar({
  onSearch,
  onShortcuts,
  setupPending,
  installationAdmin,
}: {
  onSearch: () => void
  onShortcuts: () => void
  setupPending: boolean
  installationAdmin: boolean
}) {
  const modifier = useShortcutModifier()
  const pathname = usePathname()
  const router = useRouter()
  const { user: you } = useWorkspace()
  const [logoutOpen, setLogoutOpen] = React.useState(false)

  return (
    <Sidebar
      collapsible="icon"
      className="bg-background/90 border-double-r backdrop-blur-md"
    >
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            {setupPending ? (
              <SidebarMenuButton
                render={<Link href="/emails" />}
                tooltip="Return to setup"
              >
                <ArrowLeftIcon />
                <span>Setup</span>
              </SidebarMenuButton>
            ) : (
              <TeamSwitcher />
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {!setupPending && (
                <SidebarMenuItem className="mb-1">
                  <SidebarMenuButton
                    variant="outline"
                    tooltip={{
                      children: (
                        <>
                          Search <Kbd>{modifier} K</Kbd>
                        </>
                      ),
                    }}
                    aria-keyshortcuts={
                      modifier === "⌘" ? "Meta+K" : "Control+K"
                    }
                    onClick={onSearch}
                  >
                    <SearchIcon />
                    <span>Search</span>
                    <Kbd className="ml-auto px-1.5 group-data-[collapsible=icon]:hidden">
                      <span>{modifier}</span>
                      <span>K</span>
                    </Kbd>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              {DASHBOARD_NAV.filter(
                (item) => !setupPending || item.href === "/domains"
              ).map((item) => {
                const Icon = item.icon
                const active = navItemActive(pathname, item)
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={active}
                      tooltip={{
                        hidden: false,
                        children: (
                          <>
                            {item.title}
                            <NavigationKeys href={item.href} />
                          </>
                        ),
                      }}
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
            <SidebarMenuButton
              onClick={onShortcuts}
              aria-keyshortcuts="Shift+/"
              tooltip={{
                children: (
                  <>
                    Keyboard shortcuts <Kbd>?</Kbd>
                  </>
                ),
              }}
            >
              <KeyboardIcon />
              <span>Keyboard shortcuts</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarCollapseButton />
          </SidebarMenuItem>
          {!setupPending && (
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
                    {installationAdmin &&
                      INSTANCE_PAGES.map(({ href, title, icon: Icon }) => (
                        <DropdownMenuItem
                          key={href}
                          render={<Link href={href} />}
                        >
                          <Icon />
                          {title}
                        </DropdownMenuItem>
                      ))}
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <AppearanceItems />
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    render={
                      <a
                        href={MARKETING_URL}
                        target="_blank"
                        rel="noreferrer"
                      />
                    }
                  >
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
                render={
                  <a
                    href={docsHrefForRoute(pathname)}
                    target="_blank"
                    rel="noreferrer"
                  />
                }
              >
                <BookOpenIcon />
                <span className="sr-only">Docs</span>
              </SidebarMenuButton>
              <ConfirmDialog
                open={logoutOpen}
                onOpenChange={setLogoutOpen}
                title="Log out?"
                description="You can sign in again at any time."
                confirmLabel="Log out"
                onConfirm={async () => {
                  await authResult(await authClient.signOut())
                  router.push("/login")
                  router.refresh()
                }}
              />
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function DashboardChrome({ children }: { children: React.ReactNode }) {
  const [searchOpen, setSearchOpen] = React.useState(false)
  const installation = useQuery(api.installation.status)
  const setupPending = !installation?.installation?.completedAt
  const installationAdmin = installation?.admin === true

  const [shortcutsOpen, setShortcutsOpen] = React.useState(false)
  const { resolvedTheme, setTheme } = useTheme()
  useShortcut("mod+k", () => setSearchOpen(true), { enabled: !setupPending })
  useShortcut("?", () => setShortcutsOpen(true))
  useShortcut("d", () => setTheme(resolvedTheme === "dark" ? "light" : "dark"))

  return (
    <div className="hatch min-h-svh">
      <SidebarProvider>
        {!setupPending && <NavigationShortcuts />}
        <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
        <DashboardSidebar
          setupPending={setupPending}
          installationAdmin={installationAdmin}
          onSearch={() => setSearchOpen(true)}
          onShortcuts={() => setShortcutsOpen(true)}
        />
        <SidebarInset className="min-w-0 bg-background">
          <div className="flex min-h-0 w-full flex-1 flex-col gap-6 px-6 py-8 md:px-10">
            <SidebarTrigger className="-ml-1 md:hidden" />
            {children}
          </div>
        </SidebarInset>
        {!setupPending && (
          <CommandMenu
            onShortcuts={() => setShortcutsOpen(true)}
            open={searchOpen}
            onOpenChange={setSearchOpen}
            installationAdmin={installationAdmin}
          />
        )}
      </SidebarProvider>
    </div>
  )
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <Toaster>
        <ShortcutProvider>
          <DashboardChrome>{children}</DashboardChrome>
        </ShortcutProvider>
      </Toaster>
    </WorkspaceProvider>
  )
}

/** The same workspace and toasts without the sidebar, for full-screen
    editors that own the whole viewport. */
export function FullScreenShell({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <Toaster>
        <ShortcutProvider>
          <EditorShortcuts />
          {children}
        </ShortcutProvider>
      </Toaster>
    </WorkspaceProvider>
  )
}

function NavigationShortcut({
  href,
  letter,
}: {
  href: string
  letter: string
}) {
  const router = useRouter()
  useShortcut(`g ${letter}`, () => router.push(href))
  return null
}

function NavigationShortcuts() {
  return (
    <>
      {Object.entries(NAVIGATION_SHORTCUTS).map(([href, letter]) => (
        <NavigationShortcut key={href} href={href} letter={letter} />
      ))}
    </>
  )
}

function EditorShortcuts() {
  const [open, setOpen] = React.useState(false)
  const [searchOpen, setSearchOpen] = React.useState(false)
  const installation = useQuery(api.installation.status)
  const { resolvedTheme, setTheme } = useTheme()
  useShortcut("?", () => setOpen(true))
  useShortcut("mod+k", () => setSearchOpen(true))
  useShortcut("d", () => setTheme(resolvedTheme === "dark" ? "light" : "dark"))
  return (
    <>
      <NavigationShortcuts />
      <ShortcutsDialog open={open} onOpenChange={setOpen} />
      <CommandMenu
        open={searchOpen}
        onOpenChange={setSearchOpen}
        installationAdmin={installation?.admin === true}
        onShortcuts={() => setOpen(true)}
      />
    </>
  )
}
