"use client"
import { useState } from "react"
import { useMutation, useQuery } from "convex/react"
import { BlocksIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import { oauthScopes, type OAuthScope } from "@/lib/oauth/policy"
import { formatDate } from "@/lib/dashboard/format"
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import {
  SettingsCard,
  EmptyState,
  MoreMenu,
  Th,
  ConfirmDialog,
} from "./primitives"
export function OAuthAppsCard() {
  return (
    <SettingsCard title="OAuth apps" flush>
      <OAuthAppsList />
    </SettingsCard>
  )
}

export function OAuthAppsList({ organizationId }: { organizationId?: string }) {
  const grants = useQuery(
    api.oauth.list,
    organizationId ? { organizationId } : {}
  )
  const disconnect = useMutation(api.oauth.disconnect)
  const [target, setTarget] = useState<{
    id: string
    application: string
  } | null>(null)
  return (
    <>
      {grants === undefined ? (
        <p role="status" className="p-6 text-sm text-muted-foreground">
          Loading authorized apps…
        </p>
      ) : grants.length === 0 ? (
        <EmptyState
          size="sm"
          icon={BlocksIcon}
          title="No authorized apps"
          description={
            organizationId
              ? "When someone on this team authorizes a third-party app, their consent will appear here."
              : "Third-party apps you authorize to access your account will appear here."
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <Th>Application</Th>
              <Th>Team</Th>
              <Th>Permissions</Th>
              <Th>Authorized</Th>
              <Th className="w-10">
                <span className="sr-only">Actions</span>
              </Th>
            </TableRow>
          </TableHeader>
          <TableBody>
            {grants.map((grant) => (
              <TableRow key={grant.id}>
                <TableCell className="font-medium">
                  {grant.application}
                </TableCell>
                <TableCell>{grant.team}</TableCell>
                <TableCell>
                  {grant.scopes
                    .map((s) => oauthScopes[s as OAuthScope])
                    .join(", ")}
                </TableCell>
                <TableCell>{formatDate(grant.createdAt)}</TableCell>
                <TableCell>
                  <MoreMenu>
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setTarget(grant)}
                      >
                        Revoke access
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </MoreMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <ConfirmDialog
        open={!!target}
        onOpenChange={(open) => {
          if (!open) setTarget(null)
        }}
        title="Revoke application access"
        description={`Disconnect ${target?.application ?? "this application"}? Its access to this team will end immediately.`}
        confirmLabel="Revoke access"
        onConfirm={async () => {
          if (target)
            await disconnect({
              id: target.id,
              ...(organizationId ? { organizationId } : {}),
            })
        }}
      />
    </>
  )
}
