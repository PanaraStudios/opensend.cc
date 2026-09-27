import { httpRouter } from "convex/server"
import { registerAuthRoutes } from "./authHttp"
import { registerOAuthRoutes } from "./oauthHttp"
import { registerSesRoutes } from "./ses/http"

/* Each feature registers its own routes, so features can be built in
   parallel without editing the same lines here. */
const http = httpRouter()
registerSesRoutes(http)
registerAuthRoutes(http)
registerOAuthRoutes(http)
export default http
