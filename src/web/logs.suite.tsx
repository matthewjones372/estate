/** @jsxImportSource solid-js */
/** A service's logs on the page, in happy-dom: run by `logs.test.ts` once Solid's compiler is in place. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mount } from "./harness"
import { Overview } from "./pages/Overview"
import { LogsPanel, searchPause } from "./parts/Logs"

// These read and act on alerts' cards, which a viewer now chooses over the rows shown first (spec 0065).
beforeEach(() => window.localStorage.setItem("estate.alerts.layout", "cards"))
afterEach(() => window.localStorage.removeItem("estate.alerts.layout"))

const texts = (container: HTMLElement) =>
  [...container.querySelectorAll(".log-lines .log-text")].map((each) => each.textContent)

const line = (minute: number, level: string, text: string, pod = "storefront-2") => ({
  at: `2026-10-03T11:${minute}:00.000Z`,
  pod,
  level,
  text,
})

describe("a service's live lines", () => {
  test("arrive as they are read, the same line never twice, and filter by level and text", async () => {
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
    await Bun.sleep(searchPause + 50)
    expect(texts(page.container)).toEqual(["ERROR disk full"])
  })

  test("are searched with a star or a pattern, the matches marked and counted", async () => {
    const page = mount(() => <LogsPanel service="storefront" />)
    const search = page.container.querySelector<HTMLInputElement>(".log-search input")
    if (search === null) throw new Error("no search")
    page.type(search, "order*lost")
    await Bun.sleep(searchPause + 50)
    expect(texts(page.container)).toEqual(["ERROR order 41 lost"])
    const marks = [...page.container.querySelectorAll(".log-lines mark")].map((each) => each.textContent)
    expect(marks).toEqual(["order 41 lost"])
    expect(page.container.textContent).toContain("1 of the last 3 lines match")
    page.type(search, "/(order/")
    await Bun.sleep(searchPause + 50)
    expect(texts(page.container)).toHaveLength(3)
    expect(page.container.textContent).toContain("Not a valid pattern")
  })

  test("are copied as text, one, a shift-clicked range or every shown line, and saved to a file", async () => {
    const copied: Array<string> = []
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => void copied.push(text) },
    })
    const saved: Array<string> = []
    const click = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      saved.push(this.download)
    }
    const page = mount(() => <LogsPanel service="storefront" />)
    page.click(page.button("Copy 3 lines"))
    await page.settle()
    expect(copied[0]?.split("\n")).toHaveLength(3)
    expect(copied[0]).toContain("\tstorefront-1\tERROR\torder 41 lost")
    const picks = [...page.container.querySelectorAll<HTMLButtonElement>(".log-pick")]
    page.click(picks[1] as HTMLButtonElement)
    expect(page.button("Resume")).toBeDefined()
    page.click(picks[2] as HTMLButtonElement, { shiftKey: true })
    page.click(page.button("Copy 2 lines"))
    await page.settle()
    expect(copied[1]?.split("\n").map((each) => each.split("\t")[3])).toEqual(["order 41 lost", "slow"])
    page.click(page.button("Save"))
    expect(saved).toEqual([expect.stringMatching(/^storefront-production-\d{4}-\d\d-\d\dT\d{4}\.log$/)])
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    expect(page.button("Copy 3 lines")).toBeDefined()
    page.click(page.button(/Copy this line/))
    await page.settle()
    expect(copied[2]).toEndWith("\tINFO\tstarted")
    HTMLAnchorElement.prototype.click = click
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

  test("say which logger wrote them and link their trace to its page, and a line with neither is as it was", () => {
    const page = mount(() => <LogsPanel service="storefront" />)
    const trace = "9406a5bf06714196d42a68207f4a4bde"
    page.sendLines({
      lines: [{ ...line(58, "WARN", "WARN order 41 paid twice"), logger: "shop.orders.Checkout", trace }],
      skipped: false,
    })
    const rows = [...page.container.querySelectorAll(".log-lines .log-line")]
    const written = rows.at(-1)
    expect(written?.querySelector(".log-logger")?.textContent).toBe("shop.orders.Checkout")
    const link = written?.querySelector<HTMLAnchorElement>("a.log-trace")
    expect(link?.getAttribute("href")).toBe(`/traces/${trace}`)
    expect(link?.textContent).toBe("trace 9406a5bf")
    expect(link?.getAttribute("title")).toContain(trace)
    expect(written?.querySelector(".log-text")?.textContent).toBe("WARN order 41 paid twice")
    expect(rows[0]?.querySelector(".log-fields")).toBeNull()
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

  test("are filtered once typing pauses, not at every key, and all shown again as soon as the search is cleared", async () => {
    const page = mount(() => <LogsPanel service="storefront" />)
    const search = page.container.querySelector<HTMLInputElement>(".log-search input")
    if (search === null) throw new Error("no search")
    // While the keys come, nothing is filtered: "o" alone would already hide a line.
    for (const typed of ["o", "or", "ord", "order"]) page.type(search, typed)
    expect(texts(page.container)).toHaveLength(3)
    await Bun.sleep(searchPause + 50)
    expect(texts(page.container)).toEqual(["ERROR order 41 lost"])
    page.type(search, "")
    expect(texts(page.container)).toHaveLength(3)
    page.dispose()
  })

  test("are searched with their pattern built once, however many lines there are", async () => {
    const page = mount(() => <LogsPanel service="storefront" />)
    const search = page.container.querySelector<HTMLInputElement>(".log-search input")
    if (search === null) throw new Error("no search")
    const Real = RegExp
    let made = 0
    globalThis.RegExp = new Proxy(Real, {
      construct: (target, args) => {
        made += 1
        return Reflect.construct(target, args)
      },
    })
    try {
      page.type(search, "order*lost")
      await Bun.sleep(searchPause + 50)
    } finally {
      globalThis.RegExp = Real
    }
    // One to test each line, one to mark what matched.
    expect(made).toBe(2)
    expect(texts(page.container)).toEqual(["ERROR order 41 lost"])
    page.dispose()
  })

  test("filtered to errors, bring the lines around each, dimmed, with the gap between runs, and copy them too", async () => {
    window.localStorage.removeItem("estate.logs.around")
    const copied: Array<string> = []
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => void copied.push(text) },
    })
    const page = mount(() => <LogsPanel service="storefront" />)
    page.sendLines({
      lines: [1, 2, 3, 4, 5]
        .map((each) => line(50 + each, "INFO", `INFO step ${each}`))
        .concat(line(58, "ERROR", "ERROR disk full")),
      skipped: false,
    })
    page.click(page.button(/^Warn/))
    page.click(page.button(/^Info/))
    expect(texts(page.container)).toEqual(["ERROR order 41 lost", "ERROR disk full"])
    const choice = page.container.querySelector<HTMLSelectElement>(".log-around select")
    if (choice === null) throw new Error("no Around")
    page.type(choice, "2")
    expect(texts(page.container)).toEqual([
      "INFO started",
      "ERROR order 41 lost",
      "WARN slow",
      "INFO step 1",
      "INFO step 4",
      "INFO step 5",
      "ERROR disk full",
    ])
    const rows = [...page.container.querySelectorAll(".log-lines .log-line")]
    expect(rows.map((row) => row.classList.contains("around"))).toEqual([true, false, true, true, true, true, false])
    expect(rows.map((row) => row.classList.contains("gap"))).toEqual([false, false, false, false, true, false, false])
    expect(rows[0]?.textContent).toContain("around a match")
    expect(page.container.textContent).toContain("2 of the last 9 lines match, with 2 lines around each")
    expect(window.localStorage.getItem("estate.logs.around")).toBe("2")
    page.click(page.button("Copy 7 lines"))
    await page.settle()
    expect(copied[0]?.split("\n")).toHaveLength(7)
    page.dispose()
    window.localStorage.removeItem("estate.logs.around")
  })

  test("arrive without a screen reader reading each one aloud", () => {
    const page = mount(() => <LogsPanel service="storefront" />)
    expect(page.container.querySelector(".log-lines")?.closest("[aria-live]")).toBeNull()
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
    const copied: Array<string> = []
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => void copied.push(text) },
    })
    page.click(page.button("Copy these lines"))
    await page.settle()
    expect(copied[0]?.split("\n")).toHaveLength(2)
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
