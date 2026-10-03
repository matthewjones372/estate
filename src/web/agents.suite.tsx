/** @jsxImportSource solid-js */
/** An agent's recent runs on its lane, in happy-dom: run by \`agents.test.ts\` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import { mount } from "./harness"
import { AgentLane } from "./parts/AgentLane"

const lane = (name: string) =>
  mount(() => (
    <AgentLane agent={{ name, links: [], runs: true }} state={{ name, health: "healthy", reasons: [], usage: {} }} />
  ))

describe("an agent's recent runs", () => {
  test("are read when opened: each one's outcome, how long, its tokens, cost and model, and its trace", async () => {
    const page = lane("triage")
    page.click(page.button("Recent runs"))
    await page.settle()
    expect(page.calls).toContainEqual(["runs", "triage"])
    const runs = [...page.container.querySelectorAll('[aria-label="Recent runs of triage"] li')].map(
      (each) => each.textContent,
    )
    expect(runs[0]).toContain("failed in 31 s: tool search_orders timed out")
    expect(runs[0]).toContain("12k tokens · $0.041 · claude-sonnet")
    expect(runs[0]).toContain("Trace")
    expect(runs[1]).toContain("done in 10 s")
    expect(runs[1]).not.toContain("Trace")
  })

  test("say there are none, or that they could not be read", async () => {
    const none = lane("summariser")
    none.click(none.button("Recent runs"))
    await none.settle()
    expect(none.container.textContent).toContain("No runs to read here.")
    const broken = lane("broken")
    broken.click(broken.button("Recent runs"))
    await broken.settle()
    expect(broken.container.textContent).toContain("The runs could not be read.")
  })
})
