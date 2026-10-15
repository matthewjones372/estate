import { describe, expect, test } from "bun:test"
import { Effect, Result } from "effect"
import type { Incident } from "../shared/incidents"
import { fakeDynamo, usingNotes } from "./dynamo-fake"
import { incidentTimeline } from "./incident-timeline"
import { memoryNotes, Notes, type Notes as NotesService, postgresNotes, type Query } from "./notes"
import type { StoredIncidentEvent } from "./notes-events"
import { type Call, stubRemote } from "./remote"

const firing = { environment: "production", alert: "a1", startsAt: "2026-10-12T14:02:11.000Z" }
const incident: Incident = {
  id: "i1",
  title: "Chip registry slow",
  openedBy: "gil",
  openedAt: "2026-10-12T14:03:00.000Z",
  firings: [{ ...firing, linkedBy: "gil", linkedAt: "2026-10-12T14:03:00.000Z" }],
}
const own = (id: string, at: string, more: Partial<StoredIncidentEvent> = {}): StoredIncidentEvent => ({
  incident: "i1",
  id,
  at,
  recordedAt: at,
  source: "seen",
  by: "Estate",
  kind: "incident-noted",
  text: `event ${id}`,
  ...more,
})

// Kept out of order, beside another incident's, with one written later than it happened.
const keepAndRead = (notes: NotesService) =>
  Effect.gen(function* () {
    yield* notes.addEvent({
      ...firing,
      id: "f1",
      at: firing.startsAt,
      recordedAt: firing.startsAt,
      source: "seen",
      by: "Estate",
      kind: "fired",
      text: "warning",
    })
    yield* notes.addIncidentEvent(
      own("w1", "2026-10-12T14:05:00.000Z", {
        by: "gil",
        source: "written",
        recordedAt: "2026-10-12T14:31:00.000Z",
        service: "registry",
        text: "Rolled the registry back by hand",
      }),
    )
    yield* notes.addIncidentEvent(own("r1", "2026-10-12T13:58:20.000Z", { source: "rebuilt", service: "petshop" }))
    yield* notes.addIncidentEvent(own("x1", "2026-10-12T14:00:00.000Z", { incident: "i2" }))
    return yield* incidentTimeline(incident).pipe(Effect.provideService(Notes, notes))
  })

const expectations = (timeline: Effect.Success<ReturnType<typeof keepAndRead>>) => {
  expect(timeline.map((event) => [event.id, event.source, event.service, event.alert])).toEqual([
    ["r1", "rebuilt", "petshop", undefined],
    ["f1", "seen", undefined, "a1"],
    ["w1", "written", "registry", undefined],
  ])
  expect(timeline[2]?.recordedAt).toBe("2026-10-12T14:31:00.000Z")
}

/** A database that keeps events as Postgres would, enough for the statements the two kinds of event use. */
const eventsDatabase = (): Query => {
  const rows: Record<string, Array<Record<string, unknown>>> = { estate_events: [], estate_incident_events: [] }
  const columns = {
    estate_events: [
      "id",
      "environment",
      "alert",
      "starts_at",
      "at",
      "by",
      "kind",
      "text",
      "link",
      "read_logs",
      "recorded_at",
      "source",
      "service",
    ],
    estate_incident_events: [
      "id",
      "incident",
      "at",
      "by",
      "kind",
      "text",
      "link",
      "read_logs",
      "recorded_at",
      "source",
      "service",
    ],
  }
  const time = new Set(["starts_at", "at", "recorded_at"])
  return (statement, parameters) => {
    const table = statement.includes("estate_incident_events") ? "estate_incident_events" : "estate_events"
    if (statement.startsWith("insert into"))
      rows[table]?.push(
        Object.fromEntries(
          columns[table].map((column, index) => {
            const value = parameters[index] ?? null
            return [column, time.has(column) && value !== null ? new Date(String(value)) : value]
          }),
        ),
      )
    if (statement.startsWith("select"))
      return Effect.succeed(
        (rows[table] ?? [])
          .filter((row) =>
            table === "estate_incident_events"
              ? row["incident"] === parameters[0]
              : row["environment"] === parameters[0] &&
                row["alert"] === parameters[1] &&
                (row["starts_at"] as Date).getTime() === Date.parse(String(parameters[2])),
          )
          .toSorted((a, b) => (a["at"] as Date).getTime() - (b["at"] as Date).getTime()),
      )
    return Effect.succeed([])
  }
}

const target = (operation: string, body: object): Call => ({
  url: "https://dynamodb.eu-west-2.amazonaws.com/",
  method: "POST",
  headers: { "x-amz-target": `DynamoDB_20120810.${operation}` },
  body: JSON.stringify({ TableName: "estate-notes", ...body }),
})

describe("an incident's own events", () => {
  test("are kept in memory beside its firings', in order by when they happened", () =>
    Effect.runPromise(Effect.flatMap(Notes, keepAndRead).pipe(Effect.provide(memoryNotes))).then(expectations))

  test("are kept in Postgres beside its firings', in order by when they happened", () =>
    Effect.runPromise(Effect.flatMap(Notes, keepAndRead).pipe(Effect.provide(postgresNotes(eventsDatabase())))).then(
      expectations,
    ))

  test("are kept in DynamoDB beside its firings', in order by when they happened", () =>
    Effect.runPromise(usingNotes(keepAndRead, stubRemote(fakeDynamo([])))).then((result) => {
      expect(Result.isSuccess(result)).toBe(true)
      if (Result.isSuccess(result)) expectations(result.success)
    }))
})

describe("an event kept before events said where they came from", () => {
  test("reads from Postgres as seen, kept when it happened", () => {
    const query = eventsDatabase()
    const old = ["e0", "production", "a1", firing.startsAt, firing.startsAt, "Estate", "fired", "warning"]
    return Effect.runPromise(
      Effect.flatMap(Notes, (notes) =>
        Effect.andThen(query("insert into estate_events", old), notes.events(firing)),
      ).pipe(Effect.provide(postgresNotes(query))),
    ).then(([event]) => {
      expect(event?.source).toBe("seen")
      expect(event?.recordedAt).toBe(firing.startsAt)
    })
  })

  test("reads from DynamoDB as seen, kept when it happened", () => {
    const dynamo = fakeDynamo([])
    dynamo(target("CreateTable", {}))
    dynamo(
      target("PutItem", {
        Item: {
          pk: { S: "!event#production#a1#" },
          sk: { S: `${firing.startsAt}#${firing.startsAt}#e0` },
          id: { S: "e0" },
          environment: { S: "production" },
          alert: { S: "a1" },
          time: { S: firing.startsAt },
          by: { S: "Estate" },
          text: { S: JSON.stringify({ kind: "fired", text: "warning", at: firing.startsAt }) },
        },
      }),
    )
    return Effect.runPromise(usingNotes((notes) => notes.events(firing), stubRemote(dynamo))).then((result) => {
      expect(Result.isSuccess(result) ? result.success.map((each) => [each.source, each.recordedAt]) : []).toEqual([
        ["seen", firing.startsAt],
      ])
    })
  })
})
