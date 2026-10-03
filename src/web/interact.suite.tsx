/** @jsxImportSource solid-js */
/** What a person does on the page, in happy-dom: run by \`interact.test.ts\` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import { events, listening, operator } from "./fixture"
import { mount } from "./harness"
import { Alerts } from "./pages/Alerts"
import { Overview } from "./pages/Overview"
import { ServicePage } from "./pages/Service"
import { A } from "./parts/A"
import { Header } from "./parts/Header"

describe("an overview of a catalog with categories", () => {
  test("puts each category's lanes under its heading, in the catalog's order, and the rest last", () => {
    const catalog = events.catalog
    if (catalog === undefined) throw new Error("no catalog")
    const page = mount(() => <Overview />, {
      sent: {
        ...events,
        catalog: {
          ...catalog,
          services: [
            { ...catalog.services[1], name: "orders", links: [], category: "Payments" },
            { ...catalog.services[0], name: "storefront", links: [] },
          ],
          stores: [{ name: "orders-db", engine: "postgres", links: [], category: "Payments" }],
        },
      },
    })
    const groups = [...page.container.querySelectorAll(".lanes-group")].map((group) => [
      group.querySelector("h2")?.textContent,
      [...group.querySelectorAll(".lane .lane-name, .lane a.mono")].length,
    ])
    expect(groups.map(([title]) => title)).toEqual(["Payments", "Everything else"])
    expect(page.container.querySelector('[aria-label="The estate by area"]')).not.toBeNull()
    expect(page.container.textContent).not.toContain("Stores")
  })
})

describe("acting on an alert", () => {
  test("adds a note", async () => {
    const page = mount(() => <Overview />)
    const input = page.container.querySelector<HTMLInputElement>(".note-form input")
    if (input === null) throw new Error("no note input")
    page.type(input, "  vacuuming the table  ")
    await page.settle()
    page.click(page.button("Add note"))
    await page.settle()
    expect(page.calls).toContainEqual(["addNote", "a1", "vacuuming the table"])
  })

  test("silences it for a chosen time, only with a reason", async () => {
    const page = mount(() => <Overview />)
    page.click(page.button("Silence…"))
    page.click(page.button("6 hours"))
    const silence = page.button(/^Silence until/)
    expect(silence.disabled).toBe(true)
    const reason = page.container.querySelector<HTMLInputElement>(".reason input")
    if (reason === null) throw new Error("no reason input")
    page.type(reason, "vacuum on the database")
    await page.settle()
    page.click(page.button(/^Silence until/))
    await page.settle()
    expect(page.calls).toContainEqual(["silence", "a1", 360, "vacuum on the database"])
    expect(page.container.textContent).not.toContain("Silence until")
  })

  test("cancelling the silence closes it, and a silenced one can be unsilenced", () => {
    const page = mount(() => <Overview />)
    page.click(page.button("Silence…"))
    page.click(page.button("Cancel"))
    expect(page.container.textContent).not.toContain("Silence until")
    page.click(page.button("Unsilence"))
    expect(page.calls).toContainEqual(["unsilence", "s1"])
  })
})

describe("the page as events arrive", () => {
  test("changes only what changed: a note being written survives the next alerts event", async () => {
    const { live, send } = listening()
    send("catalog", events.catalog)
    send("alerts", events.alerts)
    const page = mount(() => <Overview />, { live })
    const input = page.container.querySelector<HTMLInputElement>(".note-form input")
    if (input === null) throw new Error("no note input")
    page.type(input, "half written")
    const [first, ...rest] = events.alerts.alerts
    if (first === undefined) throw new Error("no alert")
    send("alerts", { ...events.alerts, alerts: [{ ...first, summary: "Orders are very slow" }, ...rest] })
    await page.settle()
    expect(page.container.textContent).toContain("Orders are very slow")
    expect(page.container.querySelector<HTMLInputElement>(".note-form input")).toBe(input)
    expect(input.value).toBe("half written")
    live.choose("staging")
    await page.settle()
    expect(page.container.textContent).not.toContain("Orders are very slow")
  })
})

describe("a note", () => {
  test("is removed by an operator, or by whoever wrote it", () => {
    const page = mount(() => <Overview />)
    page.click(page.button(/^Remove/))
    expect(page.calls).toContainEqual(["removeNote", "n1"])
  })
})

describe("the alerts page", () => {
  test("filters by state and by service, and opens one to act on", () => {
    const page = mount(() => <Alerts />)
    page.click(page.button(/^Silenced/))
    expect(page.container.querySelectorAll("tbody tr")).toHaveLength(1)
    page.click(page.button(/^All/))
    const select = page.container.querySelector("select")
    if (select === null) throw new Error("no service select")
    page.type(select, "orders")
    expect(page.container.querySelector("tbody")?.textContent).toContain("QueueGrowing")
    expect(page.container.querySelector("tbody")?.textContent).not.toContain("Orders are slow")
    page.type(select, "")
    page.click(page.button(/^Pending/))
    expect(page.container.textContent).toContain("QueueGrowing")
    page.click(page.button(/^Firing/))
    page.click(page.button("Notes and silence"))
    expect(page.container.querySelector(".alert-card")).not.toBeNull()
    page.click(page.button("Close"))
    expect(page.container.querySelector(".alert-card")).toBeNull()
    page.click(page.button(/^Silenced/))
    page.click(page.button("Unsilence"))
    expect(page.calls).toContainEqual(["unsilence", "s1"])
  })
})

describe("debug", () => {
  const off = {
    ...events,
    services: {
      ...events.services,
      services: events.services.services.map((each) => ({ ...each, debug: { level: "INFO", on: false } })),
    },
  }

  test("cannot be switched where Estate is read-only, which the header says", () => {
    const page = mount(() => <ServicePage name="storefront" />, { sent: off, me: { ...operator, readOnly: true } })
    expect(page.container.textContent).not.toContain("Turn on debug")
    page.dispose()
    const header = mount(() => <Header />, { me: { ...operator, readOnly: true } })
    expect(header.container.textContent).toContain("operator · read-only")
    header.dispose()
  })

  test("is turned on for a chosen time, after saying what it costs", async () => {
    const page = mount(() => <ServicePage name="storefront" />, { sent: off })
    page.click(page.button("1 hour"))
    page.click(page.button("Turn on debug…"))
    expect(page.container.textContent).toContain("DEBUG for storefront, 1 hour?")
    page.click(page.button("Cancel"))
    page.click(page.button("Turn on debug…"))
    page.click(page.button("Turn on"))
    await page.settle()
    expect(page.calls).toContainEqual(["debug", "storefront", 60])
  })

  test("is turned off before its time", () => {
    const page = mount(() => <ServicePage name="storefront" />)
    page.click(page.button("Turn off now"))
    expect(page.calls).toContainEqual(["undebug", "storefront"])
  })
})

describe("the service's load", () => {
  test("is read again for a longer range", async () => {
    const page = mount(() => <ServicePage name="storefront" />)
    page.click(page.button("6h"))
    await page.settle()
    expect(page.calls).toContainEqual(["load", "storefront", "6h"])
    expect(page.container.textContent).toContain("6h ago")
  })
})

describe("reading a chart", () => {
  const charts = (page: ReturnType<typeof mount>) => [...page.container.querySelectorAll<SVGSVGElement>(".chart svg")]
  const captions = (page: ReturnType<typeof mount>) =>
    [...page.container.querySelectorAll(".chart figcaption")].map((each) => each.textContent ?? "")
  const key = (element: Element, name: string) =>
    element.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }))
  const pointer = (element: Element, type: string, clientX: number) =>
    element.dispatchEvent(
      new PointerEvent(type, { bubbles: type !== "pointerleave", clientX, button: 0, pointerId: 1 }),
    )
  const wide = (element: Element) =>
    Object.assign(element, {
      getBoundingClientRect: () => ({ left: 0, width: 600, top: 0, height: 110, right: 600, bottom: 110 }),
    })

  test("stepping with the keys marks the same moment on every chart, and Escape lets go", () => {
    const page = mount(() => <ServicePage name="storefront" />)
    const [requests] = charts(page)
    if (requests === undefined) throw new Error("no chart")
    key(requests, "End")
    key(requests, "ArrowLeft")
    const marked = captions(page)
    expect(marked.every((each) => / at \d\d:\d\d/.test(each))).toBe(true)
    key(requests, "Home")
    key(requests, "Tab")
    expect(captions(page)).not.toEqual(marked)
    key(requests, "Escape")
    expect(captions(page).some((each) => / at /.test(each))).toBe(false)
  })

  test("pointing marks a point and leaving lets go; dragging zooms every chart, and Show all goes back", () => {
    const page = mount(() => <ServicePage name="storefront" />)
    const [requests] = charts(page)
    if (requests === undefined) throw new Error("no chart")
    wide(requests)
    pointer(requests, "pointermove", 300)
    expect(captions(page)[0]).toMatch(/ at /)
    pointer(requests, "pointerleave", 300)
    expect(captions(page)[0]).not.toMatch(/ at /)
    pointer(requests, "pointerdown", 60)
    pointer(requests, "pointermove", 300)
    pointer(requests, "pointerup", 300)
    expect(page.container.textContent).toContain("Show all 1h")
    pointer(requests, "pointerdown", 100)
    pointer(requests, "pointerup", 101)
    page.click(page.button("Show all 1h"))
    expect(page.container.textContent).not.toContain("Show all")
    expect(page.container.textContent).toContain("1h ago")
  })

  test("the alert's chart reads its points too, and a sparkline answers to a pointer", () => {
    const page = mount(() => <Overview />)
    const alert = page.container.querySelector<SVGSVGElement>(".alert-card svg[tabindex], article svg[tabindex]")
    if (alert === null) throw new Error("no alert chart")
    key(alert, "End")
    expect(alert.closest("div")?.parentElement?.textContent).toMatch(/\d\d:\d\d /)
    key(alert, "Escape")
    const spark = page.container.querySelector(".spark svg")
    if (spark === null) throw new Error("no sparkline")
    wide(spark)
    pointer(spark, "pointermove", 590)
    expect(spark.closest(".spark")?.textContent).toMatch(/\d\d:\d\d/)
    spark.dispatchEvent(new FocusEvent("blur"))
  })
})

describe("getting about", () => {
  test("the switcher lists each environment with its worst, and chooses one", () => {
    const page = mount(() => <Header />)
    page.click(page.button(/Environment: production|production/))
    expect(page.container.textContent).toContain("needs attention")
    page.click(page.button(/^staging/))
    expect(page.calls).toContainEqual(["choose", "staging"])
  })

  test("a link within Estate is followed without a reload, unless asked for a new tab", () => {
    const page = mount(() => <A to="/deploys">Deploys</A>)
    const link = page.container.querySelector("a")
    if (link === null) throw new Error("no link")
    page.click(link)
    page.click(link, { ctrlKey: true })
    expect(page.calls.filter((call) => call[0] === "navigate")).toEqual([["navigate", "/deploys"]])
  })
})
