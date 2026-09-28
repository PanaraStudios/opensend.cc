import { registerReceivedDownloadRoutes } from "./receivedDownloads"
import { registerTrackingRoutes } from "./trackingHttp"
import { registerSmtpRoutes } from "./smtpHttp"
import { httpRouter } from "convex/server"
import { registerApiRoutes } from "./api/http"
import { registerAuthRoutes } from "./authHttp"
import { registerOAuthRoutes } from "./oauthHttp"
import { registerSesRoutes } from "./ses/http"
import { registerUnsubscribeRoutes } from "./unsubscribeHttp"

/* Each feature registers its own routes, so features can be built in
   parallel without editing the same lines here. */
const http = httpRouter()
registerTrackingRoutes(http)
registerSmtpRoutes(http)
registerSesRoutes(http)
registerAuthRoutes(http)
registerOAuthRoutes(http)
registerApiRoutes(http)
registerReceivedDownloadRoutes(http)
registerUnsubscribeRoutes(http)
export default http
