import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import type { Incident } from "../../shared/incidents"
import { TimelineExport } from "../../shared/timeline-export"
import { ask, environment, estate, serverFor, settings } from "../fixture"
import type { SourcedAlert } from "../state"

const startsAt = "2026-01-12T16:47:58Z"
const firing = (id: string, name: string): SourcedAlert => ({
  id,
  name,
  state: "firing",
  severity: "warning",
  startsAt,
  labels: { alertname: name },
})
const linked = (alert: string, name: string) => ({
  environment: "staging",
  alert,
  name,
  startsAt,
  linkedBy: "gil",
  linkedAt: "2026-01-12T16:50:30Z",
})
const restarted = { id: "n1", at: "2026-01-12T16:52:04Z", by: "gil", text: "registry container restarted" }
const slow: Incident = {
  id: "i1",
  title: "Chip registry slow",
  openedBy: "gil",
  openedAt: "2026-01-12T16:50:30Z",
  firings: [linked("a1", "ChipRegistryUnreachable"), linked("a2", "AdoptionsNotRecorded")],
  notes: [restarted],
}
const kept = estate({
  environments: {
    staging: environment({
      alerts: { state: "ok", value: [firing("a1", "ChipRegistryUnreachable"), firing("a2", "AdoptionsNotRecorded")] },
    }),
  },
  incidents: [slow],
  notes: [{ id: "n2", environment: "staging", alert: "a1", at: "2026-01-12T16:53:00Z", by: "ada", text: "on it" }],
})
const operator = settings({ anonymous: { name: "gil", role: "operator" } })

const exported = Effect.gen(function* () {
  const server = yield* serverFor(operator, kept)
  yield* ask(
    server,
    new Request("http://estate/api/incidents/i1/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "adoptions recovering" }),
    }),
  )
  const read = (format: string) => ask(server, new Request(`http://estate/api/incidents/i1/timeline?format=${format}`))
  return { markdown: (yield* read("md")).text, json: (yield* read("json")).json() }
})

describe("an incident's export, with notes on the incident", () => {
  test("has the incident's own notes first, its note once in the table, and each firing's own notes after", () =>
    Effect.runPromise(exported).then(({ markdown, json }) => {
      const notes = markdown.slice(markdown.indexOf("## Notes"))
      expect(notes).toMatch(
        /^## Notes\n\n### On the incident\n\n\*\*gil\*\*, 2026-01-12T16:52:04Z\n\n> registry container restarted\n\n\*\*gil\*\*, \S+Z\n\n> adoptions recovering\n\n### ChipRegistryUnreachable, staging\n\n\*\*ada\*\*, 2026-01-12T16:53:00Z\n\n> on it\n$/,
      )
      const noted = markdown.split("\n").filter((line) => line.includes("noted on the incident"))
      expect(noted).toEqual([
        expect.stringMatching(/^\| \S+Z \| gil \| \(incident\) \| noted on the incident: adoptions recovering \|$/),
      ])
      const decoded = Schema.decodeUnknownSync(TimelineExport)(json)
      expect(decoded.incident?.notes).toEqual([restarted, expect.objectContaining({ text: "adoptions recovering" })])
      expect(decoded.firings.map((each) => each.notes.map((note) => note.text))).toEqual([["on it"], []])
      expect(decoded.events.filter((each) => each.kind === "incident-noted")).toHaveLength(1)
    }))
})
