import { trackAICrawlerRequest } from "@datafast/ai-crawl"
import {
  NextResponse,
  type NextFetchEvent,
  type NextRequest,
} from "next/server"

/* Same public DataFast website ID as the browser script in app/layout.tsx.
   Bot traffic is server-side because crawlers skip frontend JS. */
const DATAFAST_WEBSITE_ID = "dfid_o6k8AKdqSx0tSKXpu3eqO"

export function proxy(request: NextRequest, event: NextFetchEvent) {
  /* Do not await: the package uses event.waitUntil and returns immediately. */
  trackAICrawlerRequest(request, event, {
    websiteId: DATAFAST_WEBSITE_ID,
    authToken: process.env.DATAFAST_BOT_TOKEN,
  })

  return NextResponse.next()
}

export const config = {
  /* Keep robots.txt, llms.txt, and sitemap files reachable by this proxy. */
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
}
