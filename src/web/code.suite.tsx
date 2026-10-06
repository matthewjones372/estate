/** @jsxImportSource solid-js */
/** A service's code health on the page, in happy-dom: run by `code.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import { mount } from "./harness"
import { CodeLine } from "./parts/CodeLine"

describe("a service's code health on the page", () => {
  test("is a quiet line linking each tool, amber when its owner should look, and nothing when there is none", () => {
    const page = mount(() => (
      <CodeLine
        code={{
          sonarqube: { gate: "failed", coverage: 71, href: "https://sonar.example/dashboard?id=storefront" },
          dependabot: {
            alerts: { critical: 1, high: 0, medium: 0, low: 0 },
            href: "https://github.com/acme/storefront/security/dependabot",
          },
          scanning: {
            alerts: { critical: 0, high: 1, medium: 0, low: 0 },
            href: "https://github.com/acme/storefront/security/code-scanning",
          },
        }}
      />
    ))
    const line = page.container.querySelector(".code-line")
    expect(line?.textContent).toBe("code: gate failed · 71% covered · 1 critical, 1 high alerts")
    expect(line?.classList.contains("needs-look")).toBe(true)
    expect([...(line?.querySelectorAll("a") ?? [])].map((link) => link.getAttribute("href"))).toEqual([
      "https://sonar.example/dashboard?id=storefront",
      "https://github.com/acme/storefront/security/dependabot",
    ])
    const quiet = mount(() => (
      <CodeLine
        code={{ dependabot: { alerts: { critical: 0, high: 0, medium: 0, low: 0 }, href: "https://github.com/x" } }}
      />
    ))
    expect(quiet.container.textContent).toBe("code: no open alerts")
    expect(quiet.container.querySelector(".needs-look")).toBeNull()
    expect(mount(() => <CodeLine code={undefined} />).container.textContent).toBe("")
  })
})
