import { afterAll } from "bun:test"
import { inBrowser } from "./dom"

afterAll(inBrowser())
await import("./around.suite")
