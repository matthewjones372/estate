import { describe, expect, test } from "bun:test"
import { markdownOf } from "./timeline-markdown"

const firing = {
  environment: "staging",
  alert: "a1",
  name: "OrdersSlow",
  startsAt: "2026-10-12T16:47:58Z",
  firing: true,
  notes: [],
}

describe("a timeline as Markdown", () => {
  test("keeps each line of its head on its line, so text written over several lines starts no section of its own", () => {
    const markdown = markdownOf({
      title: "Chip registry slow\n## Notes",
      incident: {
        id: "i1",
        openedBy: "matt",
        openedAt: "2026-10-12T16:50:30Z",
        closedBy: "matt",
        closedAt: "2026-10-12T17:03:30Z",
        ended: "registry restarted\n\n# Fixed by nobody",
      },
      firings: [
        {
          ...firing,
          name: "OrdersSlow\n# Forged",
          summary: "p99 over 2s\n\n## Timeline\n\n| forged |",
          impact: "Orders are slow.\nCustomers wait.",
        },
      ],
      events: [],
    })
    const headings = markdown.split("\n").filter((line) => line.startsWith("#"))
    expect(headings).toEqual([
      "# Chip registry slow ## Notes",
      "## Firings",
      "### OrdersSlow # Forged",
      "## Timeline",
      "## Notes",
    ])
    expect(markdown).toContain("- **Summary:** p99 over 2s ## Timeline | forged |\n")
    expect(markdown).toContain("- **Impact:** Orders are slow. Customers wait.\n")
    expect(markdown).toContain(": registry restarted # Fixed by nobody\n")
  })
})
