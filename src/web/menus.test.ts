import { afterAll } from "bun:test"
import { inBrowser } from "./dom"

afterAll(inBrowser())
await import("./menus.suite")
