import { describe, expect, test } from "bun:test"
import type { FeedItem } from "../shared/feed"
import { batchesOf } from "./feed-batches"

const at = (minute: number) => `2026-10-03T10:${String(minute).padStart(2, "0")}:00Z`
const built = (service: string, minute: number, title: string, passed = true): FeedItem => ({
  at: at(minute),
  kind: "build",
  service,
  text: `build ${passed ? "passed" : "failed"}: ${title}`,
  build: { title, passed },
})
const applied = (service: string, minute: number, version: string): FeedItem => ({
  at: at(minute),
  kind: "deploy",
  service,
  text: `${version} applied`,
  version,
})

describe("what changed today, in batches", () => {
  test("builds that passed together are one line, naming the first that needs someone", () => {
    const entries = batchesOf(
      [
        built("web", 41, "Bump the client"),
        built("checkout", 41, "New substitutions rules"),
        built("basket", 40, "Tidier logs"),
      ],
      new Set(["checkout"]),
    )
    expect(entries).toMatchObject([
      { kind: "builds", text: "3 builds passed", sub: "checkout: New substitutions rules, and 2 more", at: at(41) },
    ])
  })

  test("versions applied together are one line, with what is stuck among them", () => {
    const entries = batchesOf(
      [applied("web", 31, "main-149"), applied("checkout", 31, "main-154"), applied("inventory", 31, "main-56")],
      new Set(["checkout"]),
      new Set(["inventory"]),
    )
    expect(entries).toMatchObject([
      { kind: "versions", text: "3 versions applied", sub: "includes checkout main-154 · inventory stuck" },
    ])
  })

  test("a failed build, a lone build and batches apart in time stay lines of their own", () => {
    const entries = batchesOf([
      built("web", 50, "Faster"),
      built("web", 41, "Broken", false),
      built("orders", 30, "One"),
      built("basket", 20, "Two"),
    ])
    expect(entries.map((entry) => entry.kind)).toEqual(["item", "item", "item", "item"])
  })

  test("an alert that fired within half an hour of a version applied to its service says how long after", () => {
    const fired: FeedItem = { at: at(53), kind: "alert", service: "checkout", text: "CheckoutSlow fired" }
    const elsewhere: FeedItem = { at: at(54), kind: "alert", service: "web", text: "WebSlow fired" }
    const entries = batchesOf([elsewhere, fired, applied("checkout", 31, "main-154"), applied("orders", 31, "v2")])
    expect(entries[0]).toEqual({ kind: "item", item: elsewhere })
    expect(entries[1]).toEqual({ kind: "item", item: fired, after: "22 min after checkout main-154 applied" })
  })
})
