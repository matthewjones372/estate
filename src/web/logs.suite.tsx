/** @jsxImportSource solid-js */
/** A service's logs on the page, in happy-dom: run by `logs.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import { mount } from "./harness"
import { Overview } from "./pages/Overview"
import { LogsPanel } from "./parts/Logs"

const texts = (container: HTMLElement) =>
  [...container.querySelectorAll(".log-lines .log-text")].map((each) => each.textContent)

const line = (minute: number, level: string, text: string, pod = "storefront-2") => ({
  at: `2026-10-03T11:${minute}:00.000Z`,
  pod,
  level,
  text,
})

describe("a service's live lines", () => {
  test("arrive as they are read, the same line never twice, and filter by level and text", () => {
    const page = mount(() => <LogsPanel service="storefront" />)
    expect(texts(page.container)).toEqual(["INFO started", "ERROR order 41 lost", "WARN slow"])
    expect(page.container.textContent).toContain("from Loki")
    page.sendLines({
      lines: [line(57, "WARN", "WARN slow", "storefront-1"), line(58, "ERROR", "ERROR disk full")],
      skipped: true,
    })
    expect(texts(page.container)).toHaveLength(4)
    expect(page.container.textContent).toContain("older lines were skipped")
    page.click(page.button(/^Warn/))
    page.click(page.button(/^Info/))
    expect(texts(page.container)).toEqual(["ERROR order 41 lost", "ERROR disk full"])
    page.click(page.button(/^Info/))
    expect(texts(page.container)).toEqual(["INFO started", "ERROR order 41 lost", "ERROR disk full"])
    page.click(page.button(/^Warn/))
    const search = page.container.querySelector<HTMLInputElement>(".log-search input")
    if (search === null) throw new Error("no search")
    page.type(search, "DISK")
    expect(texts(page.container)).toEqual(["ERROR disk full"])
  })

  test("are searched with a star or a pattern, the matches marked and counted", () => {
    const page = mount(() => <LogsPanel service="storefront" />)
    const search = page.container.querySelector<HTMLInputElement>(".log-search input")
    if (search === null) throw new Error("no search")
    page.type(search, "order*lost")
    expect(texts(page.container)).toEqual(["ERROR order 41 lost"])
    const marks = [...page.container.querySelectorAll(".log-lines mark")].map((each) => each.textContent)
    expect(marks).toEqual(["order 41 lost"])
    expect(page.container.textContent).toContain("1 of the last 3 lines match")
    page.type(search, "/(order/")
    expect(texts(page.container)).toHaveLength(3)
    expect(page.container.textContent).toContain("Not a valid pattern")
  })

  test("wear their level, and each level's toggle counts its lines", () => {
    const page = mount(() => <LogsPanel service="storefront" />)
    page.sendLines({
      lines: [line(57, "fatal", "FATAL gone"), line(58, "TRACE", "TRACE step"), line(59, "", "plain")],
      skipped: false,
    })
    const badges = [...page.container.querySelectorAll(".log-lines .log-level")].map((each) => each.textContent)
    expect(badges).toEqual(["INFO", "ERROR", "WARN", "FATAL", "TRACE", ""])
    const kinds = [...page.container.querySelectorAll(".log-lines .log-line")].map((each) => each.className)
    expect(kinds).toEqual([
      "log-line info",
      "log-line error",
      "log-line warn",
      "log-line error",
      "log-line debug",
      "log-line other",
    ])
    expect(["Error 2", "Warn 1", "Info 1", "Debug 1", "Other 1"].map((name) => page.button(name))).toHaveLength(5)
    page.click(page.button("Other 1"))
    expect(texts(page.container)).not.toContain("plain")
  })

  test("pause, holding what arrives until resumed, and pause by themselves when scrolled up", () => {
    const page = mount(() => <LogsPanel service="storefront" />)
    page.click(page.button("Pause"))
    page.sendLines({ lines: [line(59, "INFO", "INFO later")], skipped: false })
    expect(texts(page.container)).toHaveLength(3)
    page.click(page.button("1 new line"))
    expect(texts(page.container)).toHaveLength(4)
    const list = page.container.querySelector(".log-lines")
    if (list === null) throw new Error("no lines")
    // Writable, as a browser's are: the scroll to the end that resuming queued still lands after this.
    Object.defineProperties(list, {
      scrollTop: { value: 0, writable: true },
      clientHeight: { value: 100 },
      scrollHeight: { value: 400 },
    })
    list.dispatchEvent(new Event("scroll"))
    expect(page.button("Resume")).toBeDefined()
    page.sendLines({ lines: [], skipped: false, failed: "Loki answered 500: down" })
    expect(page.container.textContent).toContain("The logs did not answer: Loki answered 500: down")
    page.dispose()
    expect(page.calls).toContainEqual(["unwatchLogs", "storefront"])
  })

  test("say so when there are none to read", () => {
    const page = mount(() => <LogsPanel service="orders" />)
    expect(page.container.textContent).toContain("No logs are read for orders here")
  })
})

describe("a service's errors", () => {
  test("are grouped over a range, each opening to its newest lines", async () => {
    const page = mount(() => <LogsPanel service="storefront" />)
    page.click(page.button("Errors", 0))
    await page.settle()
    expect(page.container.textContent).toContain("ERROR order ‹n› lost")
    page.click(page.button(/^2×/))
    expect(texts(page.container)).toEqual(["ERROR order 41 lost", "ERROR order 7 lost"])
    page.click(page.button("6h"))
    await page.settle()
    expect(page.calls).toContainEqual(["errors", "storefront", { range: "6h" }])
  })

  test("from the minutes before an alert started are on its card", async () => {
    const page = mount(() => <Overview />)
    page.click(page.button("Lines from then"))
    await page.settle()
    expect(page.container.textContent).toContain("Errors from ten minutes before it started")
    const asked = page.calls.find((call) => call[0] === "errors")
    expect(asked?.[2]).toHaveProperty("since")
  })
})
