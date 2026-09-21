/// <reference types="vite/client" />
import { test } from "vitest"
import { componentsGeneric } from "convex/server"
import componentSchema from "../component/schema.js"
import type { SESComponent } from "./index.js"

export const modules = import.meta.glob("./**/*.*s")
export { componentSchema }
export const componentModules = import.meta.glob("../component/**/*.ts")

export const components = componentsGeneric() as unknown as {
  ses: SESComponent
}

test("setup", () => {})
