/** @jsxImportSource solid-js */
/** An entry's cost on the page, in happy-dom: run by `costs.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import { mount } from "./harness"
import { CostLine } from "./parts/CostLine"

describe("an entry's cost on the page", () => {
  test("is a quiet line naming where its figures come from, and nothing where there is no cost", () => {
    const page = mount(() => (
      <CostLine
        cost={{
          from: "AWS Cost Explorer",
          currency: "USD",
          monthToDate: 612,
          forecast: 880,
          budget: { amount: 900, per: "month" },
        }}
      />
    ))
    const line = page.container.querySelector(".cost-line")
    expect(line?.textContent).toBe("$612 this month (forecast $880 of $900)")
    expect(line?.getAttribute("title")).toBe("From AWS Cost Explorer")
    expect(mount(() => <CostLine cost={undefined} />).container.textContent).toBe("")
  })
})
