/// <reference types="vite/client" />
import type { TestConvex } from "convex-test"
import type { GenericSchema, SchemaDefinition } from "convex/server"
import workpool from "@convex-dev/workpool/test"
import schema from "./component/schema.js"
const modules = import.meta.glob("./component/**/*.ts")

/** Register OpenSend and its nested workpool (including batchWorker). */
export function register<
  Schema extends SchemaDefinition<GenericSchema, boolean>,
>(t: TestConvex<Schema>, name = "opensend") {
  t.registerComponent(name, schema, modules)
  workpool.register(t, `${name}/workpool`)
}
export default { register, schema, modules }
