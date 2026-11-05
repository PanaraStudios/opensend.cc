import { redirect } from "next/navigation"
import { playgroundRedirectHref } from "@opensend/core/messages/links"

export default async function LegacyCallsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  redirect(playgroundRedirectHref("calls", await searchParams))
}
