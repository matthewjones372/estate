/** @jsxImportSource solid-js */
/** Menus, dialogs and what is said without a pointer, in happy-dom: run by `menus.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import { events } from "./fixture"
import { mount } from "./harness"
import { ServicePage } from "./pages/Service"
import { Header } from "./parts/Header"
import { HealthLine } from "./parts/Lane"
import { LogsPanel } from "./parts/Logs"

describe("without a pointer", () => {
  test("the environment menu is a popover its button opens, so Escape and a click elsewhere close it", () => {
    const page = mount(() => <Header />)
    const button = page.container.querySelector(".switcher-button")
    const list = page.container.querySelector("ul.switcher-list")
    expect(list?.getAttribute("popover")).toBe("auto")
    expect(button?.getAttribute("popovertarget")).toBe(list?.id ?? "")
    page.dispose()
  })

  test("debug's confirm is a modal dialog, so the page behind it waits and Escape cancels", () => {
    const off = {
      ...events,
      services: {
        ...events.services,
        services: events.services.services.map((each) => ({ ...each, debug: { level: "INFO", on: false } })),
      },
    }
    const page = mount(() => <ServicePage name="storefront" />, { sent: off })
    page.click(page.button("Turn on debug…"))
    const dialog = page.container.querySelector("dialog")
    expect(dialog?.open).toBe(true)
    expect(dialog?.getAttribute("aria-labelledby")).toBe("confirm-title")
    page.dispose()
  })

  test("every reason a service needs a look is read, not only the first", () => {
    const reasons = ["OrdersSlow is firing", "1 of 3 pods not ready", "restarted twice"]
    const page = mount(() => <HealthLine state={{ health: "attention", reasons }} />)
    expect(page.container.querySelector("[title]")).toBeNull()
    expect(page.container.querySelector(".visually-hidden")?.textContent).toBe(reasons.join("; "))
    page.dispose()
  })

  test("how to pick a range of lines is said beside them, not only to a pointer", () => {
    const page = mount(() => <LogsPanel service="storefront" />)
    expect(page.container.querySelector(".log-pick[title]")).toBeNull()
    expect(page.container.querySelector(".log-foot")?.textContent).toContain("shift-click")
    page.dispose()
  })
})
