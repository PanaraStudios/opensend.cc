"use client"

import { usePathname } from "next/navigation"
import { useQuery } from "convex/react"
import { ShieldIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import { INSTANCE_PAGES } from "@/lib/dashboard/nav"
import { PageHeader, EmptyState } from "@/components/dashboard/primitives"
import { Skeleton } from "@/components/ui/skeleton"

export default function InstanceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname()
  const page = INSTANCE_PAGES.find((item) => item.href === pathname)
  const status = useQuery(api.installation.status)
  return (
    <>
      <PageHeader
        title={page?.title ?? "Instance settings"}
        description={
          page?.description ?? "Manage settings for the whole instance."
        }
      />
      {!status ? (
        <Skeleton className="h-64 max-w-3xl" />
      ) : !status.admin ? (
        <EmptyState
          icon={ShieldIcon}
          title="Administrator access required"
          description="Only the installation administrator can manage instance settings."
        />
      ) : (
        children
      )}
    </>
  )
}
