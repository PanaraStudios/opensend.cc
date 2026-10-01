import { redirect } from "next/navigation"
import { playgroundRedirectHref } from "@/lib/messages/links"

export default async function LegacyInboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  redirect(playgroundRedirectHref("inbox", await searchParams))
}
