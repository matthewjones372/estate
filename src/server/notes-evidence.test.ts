import { describe, expect, test } from "bun:test"
import { Effect, Result } from "effect"
import type { EvidenceSet } from "../shared/evidence"
import { fakeDynamo, usingNotes } from "./dynamo-fake"
import { memoryNotes, Notes, type Notes as NotesService, postgresNotes, type Query } from "./notes"
import { stubRemote } from "./remote"

const set = (id: string, keptAt: string): EvidenceSet => ({
  id,
  keptAt,
  keptBy: "gil",
  window: { start: 1760280000, end: 1760283600, step: 60 },
  charts: [
    {
      service: "orders",
      environment: "staging",
      panel: "requests",
      query: "sum(rate(orders_total[1m]))",
      points: [1, null, 3],
    },
  ],
})

// Kept out of order, beside another incident's.
const keepAndRead = (notes: NotesService) =>
  Effect.gen(function* () {
    yield* notes.keepEvidence("i1", set("later", "2026-10-12T15:00:00.000Z"))
    yield* notes.keepEvidence("i2", set("other", "2026-10-12T14:30:00.000Z"))
    yield* notes.keepEvidence("i1", set("first", "2026-10-12T14:40:00.000Z"))
    return yield* notes.evidence("i1")
  })

const expectations = (kept: ReadonlyArray<EvidenceSet>) => {
  expect(kept.map((each) => each.id)).toEqual(["first", "later"])
  expect(kept[0]).toEqual(set("first", "2026-10-12T14:40:00.000Z"))
}

/** A database that keeps evidence as Postgres would, enough for the statements the evidence uses. */
const evidenceDatabase = (): Query => {
  const rows: Array<Record<string, unknown>> = []
  return (statement, parameters) => {
    if (statement.startsWith("insert into estate_evidence")) {
      const [id, incident, keptAt, record] = parameters
      rows.push({ id, incident, kept_at: new Date(String(keptAt)), record })
    }
    if (statement.startsWith("select") && statement.includes("from estate_evidence"))
      return Effect.succeed(
        rows
          .filter((row) => row["incident"] === parameters[0])
          .toSorted((a, b) => (a["kept_at"] as Date).getTime() - (b["kept_at"] as Date).getTime()),
      )
    return Effect.succeed([])
  }
}

describe("an incident's evidence", () => {
  test("is kept in memory, a set at a time, read oldest first", () =>
    Effect.runPromise(Effect.flatMap(Notes, keepAndRead).pipe(Effect.provide(memoryNotes))).then(expectations))

  test("is kept in Postgres, a set at a time, read oldest first", () =>
    Effect.runPromise(Effect.flatMap(Notes, keepAndRead).pipe(Effect.provide(postgresNotes(evidenceDatabase())))).then(
      expectations,
    ))

  test("is kept in DynamoDB whole, however much larger it is than an item may hold", () => {
    const large: EvidenceSet = {
      ...set("large", "2026-10-12T16:00:00.000Z"),
      logs: [
        {
          service: "orders",
          environment: "staging",
          from: "Loki",
          errors: [],
          // About a megabyte of lines that do not compress to nothing.
          lines: Array.from({ length: 2000 }, (_, index) => ({
            at: "2026-10-12T15:00:00.000Z",
            text: `${index} ${crypto.randomUUID()} ${"order written to the outbox ".repeat(12)}${crypto.randomUUID()}`,
          })),
          leftOut: 0,
        },
      ],
    }
    return Effect.runPromise(
      usingNotes(
        (notes) => Effect.andThen(notes.keepEvidence("i1", large), notes.evidence("i1")),
        stubRemote(fakeDynamo([])),
      ),
    ).then((result) => {
      expect(Result.isSuccess(result) ? result.success : []).toEqual([large])
    })
  })

  test("is kept in DynamoDB beside the notes, a set at a time, read oldest first", () =>
    Effect.runPromise(usingNotes(keepAndRead, stubRemote(fakeDynamo([])))).then((result) => {
      expect(Result.isSuccess(result)).toBe(true)
      if (Result.isSuccess(result)) expectations(result.success)
    }))
})
