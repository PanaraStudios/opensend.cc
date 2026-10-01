import { registerIvrGatewayRoutes } from "./ivr/gatewayHttp"
import { registerCallingGatewayRoutes } from "./calling/gatewayHttp"
import { registerEmailShareRoutes } from "./api/emailShares"
import { registerReceivedDownloadRoutes } from "./receivedDownloads"
import { registerBroadcastRoutes } from "./api/broadcasts"
import { registerTrackingRoutes } from "./trackingHttp"
import { registerSmtpRoutes } from "./smtpHttp"
import { httpRouter } from "convex/server"
import { registerApiRoutes } from "./api/http"
import { registerAuthRoutes } from "./authHttp"
import { registerOAuthRoutes } from "./oauthHttp"
import { registerSesRoutes } from "./ses/http"
import { registerChannelDownloadRoutes } from "./channels/downloads"
import { registerMetaRoutes } from "./meta/http"
import { registerUnsubscribeRoutes } from "./unsubscribeHttp"

/* Each feature registers its own routes, so features can be built in
   parallel without editing the same lines here. */
const http = httpRouter()
registerIvrGatewayRoutes(http)
registerCallingGatewayRoutes(http)
registerTrackingRoutes(http)
registerSmtpRoutes(http)
registerSesRoutes(http)
registerMetaRoutes(http)
registerChannelDownloadRoutes(http)
registerAuthRoutes(http)
registerOAuthRoutes(http)
registerApiRoutes(http)
registerEmailShareRoutes(http)
registerReceivedDownloadRoutes(http)
registerBroadcastRoutes(http)
registerUnsubscribeRoutes(http)
export default http
