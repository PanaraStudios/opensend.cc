import { defineApp } from "convex/server"
import ses from "@k4stack/ses/convex.config"

const app = defineApp()
app.use(ses)

export default app
