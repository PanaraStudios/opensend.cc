import { cronJobs } from "convex/server"
import { internal } from "./_generated/api.js"
const crons = cronJobs()
crons.interval("clean up old email", { hours: 24 }, internal.email.cleanup, {})
export default crons
