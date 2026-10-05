
describe("the services layout", () => {
  test("defaults to list lanes, and switches to a grid of services", () => {
    const page = mount(() => <Overview />)
    expect(page.container.querySelector('a.lane-title[href*="storefront"]')).not.toBeNull()
    expect(page.container.querySelector(".service-grid")).toBeNull()
    page.click(page.button("Grid"))
    expect(page.container.querySelector(".service-grid")).not.toBeNull()
    expect(page.container.querySelector('a.lane-title[href*="storefront"]')).toBeNull()
    expect(page.container.textContent).toContain("storefront")
    expect(page.container.textContent).toContain("orders")
    expect(page.container.querySelector('.service-card[href*="storefront"]')).not.toBeNull()
    page.click(page.button("List"))
    expect(page.container.querySelector('a.lane-title[href*="storefront"]')).not.toBeNull()
    expect(page.container.querySelector(".service-grid")).toBeNull()
  })

  test("keeps the grid choice in this browser", () => {
    const held = new Map<string, string>()
    const prior = Object.getOwnPropertyDescriptor(globalThis, "window")
    Object.defineProperty(globalThis, "window", {
      value: {
        ...globalThis.window,
        localStorage: {
          getItem: (key: string) => held.get(key) ?? null,
          setItem: (key: string, value: string) => held.set(key, value),
        },
      },
      configurable: true,
    })
    try {
      const first = mount(() => <Overview />)
      first.click(first.button("Grid"))
      expect(held.get("estate.services.layout")).toBe("grid")
      const second = mount(() => <Overview />)
      expect(second.container.querySelector(".service-grid")).not.toBeNull()
    } finally {
      if (prior === undefined) Reflect.deleteProperty(globalThis, "window")
      else Object.defineProperty(globalThis, "window", prior)
    }
  })
})
