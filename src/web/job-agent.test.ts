import { afterAll } from "bun:test"
import { inBrowser } from "./dom"

afterAll(inBrowser())
await import("./job-agent.suite")
