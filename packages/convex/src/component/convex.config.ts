import workpool from "@convex-dev/workpool/convex.config.js"
import { defineComponent } from "convex/server"

/* Owns the outgoing mail queue, retries, delivery status, and cleanup.
   The app passes credentials through the OpenSend client per enqueue. */
const component = defineComponent("opensend")

component.use(workpool)

export default component
