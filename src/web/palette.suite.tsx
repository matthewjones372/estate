/** @jsxImportSource solid-js */
/** The jump palette, in happy-dom: run by `palette.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import { events } from "./fixture"
import { mount } from "./harness"
import { Header } from "./parts/Header"
import { Jump } from "./parts/Jump"

const jumpCatalog = {
  ...events,
  catalog: {
    ...events.catalog,
    stores: [{ name: "orders-db", engine: "cnpg", links: [] }],
    agents: [{ name: "support-triage", links: [], runs: true }],
  },
}

describe("jump", () => {
  const press = (target: EventTarget, key: string, extra: KeyboardEventInit = {}) =>
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra }))
  const field = (page: ReturnType<typeof mount>) => {
    const input = page.container.querySelector<HTMLInputElement>("input.jump-input")
    if (input === null) throw new Error("no jump input")
    return input
  }

  test("⌘K opens the palette, typing storefront and Enter opens the service", async () => {
    const page = mount(() => <Header />, { sent: jumpCatalog })
    press(window, "k", { metaKey: true })
    await page.settle()
    const input = field(page)
    expect(input.getAttribute("aria-expanded")).toBe("true")
    page.type(input, "storefront")
    await page.settle()
    expect(input.getAttribute("aria-activedescendant")).toBe("jump-option-0")
    press(input, "Enter")
    await page.settle()
    expect(page.calls).toContainEqual(["navigate", "/services/storefront"])
    page.dispose()
  })

  test("Esc closes without navigating, and gives focus back to where ⌘K was pressed", async () => {
    const page = mount(
      () => (
        <>
          <button type="button">Elsewhere</button>
          <Jump />
        </>
      ),
      { sent: jumpCatalog },
    )
    document.body.append(page.container)
    page.button("Elsewhere").focus()
    press(window, "k", { ctrlKey: true })
    await page.settle()
    const input = field(page)
    page.type(input, "orders")
    await page.settle()
    press(input, "ArrowDown")
    press(input, "ArrowUp")
    press(input, "Escape")
    await page.settle()
    expect(page.container.querySelector('[aria-label="Jump to"]')).toBeNull()
    expect(document.activeElement?.textContent).toBe("Elsewhere")
    expect(page.calls.filter((call) => call[0] === "navigate")).toEqual([])
    page.container.remove()
    page.dispose()
  })

  test("a result is chosen by clicking it, and the palette closes when focus leaves it", async () => {
    const page = mount(() => <Jump />, { sent: jumpCatalog })
    const input = field(page)
    input.dispatchEvent(new FocusEvent("focus"))
    page.type(input, "orders")
    await page.settle()
    const option = page.container.querySelector<HTMLElement>('[role="option"]')
    if (option === null) throw new Error("no option")
    option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }))
    page.click(option)
    await page.settle()
    expect(page.calls.filter((call) => call[0] === "navigate").length).toBe(1)
    input.dispatchEvent(new FocusEvent("focus"))
    await page.settle()
    page.container.querySelector(".jump")?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }))
    await page.settle()
    expect(page.container.querySelector('[aria-label="Jump to"]') === null).toBe(true)
    page.dispose()
  })
})
