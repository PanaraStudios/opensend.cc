import { serverAuth } from "@/lib/auth/server"
export const GET = (request: Request) => serverAuth().handler.GET(request)
export const POST = (request: Request) => serverAuth().handler.POST(request)
