import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { ConfigProvider, Effect, Layer, Redacted } from "effect"
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers"
import { incidentTimeline } from "../src/server/incident-timeline"
import { Notes, type Notes as NotesService, type StoredNote } from "../src/server/notes"
import { dynamodbNotes } from "../src/server/notes-dynamodb"
import { platform } from "../src/server/platform"
import { notesInPostgres, postgresLayer } from "../src/server/postgres"
import { liveRemote } from "../src/server/remote"
import type { EvidenceSet } from "../src/shared/evidence"
import type { Incident } from "../src/shared/incidents"
import { urlOf } from "./real"

let postgres: StartedTestContainer
let dynamodb: StartedTestContainer

beforeAll(async () => {
  postgres = await new GenericContainer("public.ecr.aws/docker/library/postgres:17-alpine")
    .withEnvironment({ POSTGRES_PASSWORD: "estate", POSTGRES_DB: "estate" })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start()
  dynamodb = await new GenericContainer("amazon/dynamodb-local:2.6.1")
    .withCommand(["-jar", "DynamoDBLocal.jar", "-inMemory", "-sharedDb"])
    .withExposedPorts(8000)
    .withWaitStrategy(Wait.forHttp("/", 8000).forStatusCode(400))
    .start()
}, 300_000)

afterAll(async () => {
  await postgres?.stop()
  await dynamodb?.stop()
})

const note = (id: string, at: string): StoredNote => ({
  id,
  environment: "production",
  alert: "a1",
  at,
  by: "ada",
  text: `note ${id}`,
})

/** The notes as a fresh Estate would have them: a new store each time, over the same database. */
const kinds: ReadonlyArray<readonly [string, () => Layer.Layer<Notes, unknown>]> = [
  [
    "Postgres",
    () =>
      notesInPostgres.pipe(
        Layer.provide(
          postgresLayer(
            Redacted.make(`postgres://postgres:estate@${postgres.getHost()}:${postgres.getMappedPort(5432)}/estate`),
          ),
        ),
      ),
  ],
  [
    "DynamoDB Local",
    () =>
      dynamodbNotes({ table: "estate-notes", region: "eu-west-2", endpoint: urlOf(dynamodb, 8000) }).pipe(
        Layer.provide([liveRemote, platform]),
      ),
  ],
]

const keys = ConfigProvider.fromUnknown({ AWS_ACCESS_KEY_ID: "local", AWS_SECRET_ACCESS_KEY: "local" })

const withNotes = <A>(layer: Layer.Layer<Notes, unknown>, use: (notes: NotesService) => Effect.Effect<A, unknown>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* use(yield* Notes)
    }).pipe(Effect.provide(layer), Effect.provideService(ConfigProvider.ConfigProvider, keys)),
  )

const firing = { environment: "production", alert: "a1", startsAt: "2026-10-12T14:02:11.000Z" }
const incident: Incident = {
  id: "i1",
  title: "Chip registry slow",
  openedBy: "gil",
  openedAt: "2026-10-12T14:03:00.000Z",
  firings: [{ ...firing, linkedBy: "gil", linkedAt: "2026-10-12T14:03:00.000Z" }],
}
const event = { by: "Estate", kind: "deployed", source: "seen" } as const

/** Evidence of about a megabyte, more than a DynamoDB item holds, so it is kept in parts. */
const evidence = (id: string, keptAt: string): EvidenceSet => ({
  id,
  keptAt,
  keptBy: "gil",
  window: { start: 1760278931, end: 1760284800, step: 60 },
  charts: [{ service: "petshop", environment: "production", panel: "p99", query: "p99", points: [0.2, null, 1.8] }],
  logs: [
    {
      service: "petshop",
      environment: "production",
      from: "Loki",
      errors: [],
      lines: Array.from({ length: 2000 }, (_, index) => ({
        at: "2026-10-12T14:02:00.000Z",
        text: `${index} ${crypto.randomUUID()} ${"the chip registry could not be reached ".repeat(10)}`,
      })),
      leftOut: 182,
    },
  ],
})

describe("real notes", () => {
  for (const [name, layer] of kinds) {
    test(`in ${name}: kept across a restart, newest first, and gone once removed or older than keepDays`, async () => {
      await withNotes(layer(), (notes) =>
        Effect.forEach(
          [
            note("n1", "2026-09-01T10:00:00.000Z"),
            note("n2", "2026-10-03T11:00:00.000Z"),
            note("n3", "2026-10-03T11:05:00.000Z"),
          ],
          notes.add,
          { discard: true },
        ),
      )
      const restarted = await withNotes(layer(), (notes) => notes.all)
      expect(restarted.map((each) => each.id)).toEqual(["n3", "n2", "n1"])
      expect(restarted[0]).toEqual(note("n3", "2026-10-03T11:05:00.000Z"))
      const after = await withNotes(layer(), (notes) =>
        Effect.andThen(Effect.all([notes.remove("n2"), notes.removeBefore("2026-10-01T00:00:00.000Z")]), notes.all),
      )
      expect(after.map((each) => each.id)).toEqual(["n3"])
    })

    test(`in ${name}: a firing keeps what its alert said across a restart, and one kept without it reads without`, async () => {
      const said = {
        environment: "production",
        alert: "a1",
        name: "OrdersSlow",
        service: "orders",
        severity: "critical",
        summary: "p99 over 2s",
        runbook: "https://wiki.example/orders",
        store: "orders-db",
        startsAt: "2026-10-06T09:00:00.000Z",
      }
      const bare = { environment: "production", alert: "a2", name: "QueueDeep", startsAt: "2026-10-06T10:00:00.000Z" }
      await withNotes(layer(), (notes) =>
        Effect.all([
          notes.keepFiring(said),
          notes.keepFiring({ ...said, endsAt: "2026-10-06T09:22:00.000Z" }),
          notes.keepFiring(bare),
        ]),
      )
      const read = await withNotes(layer(), (notes) => notes.firings("2026-10-01T00:00:00.000Z"))
      expect(read).toEqual([bare, { ...said, endsAt: "2026-10-06T09:22:00.000Z" }])
    })

    test(`in ${name}: an incident's own events and its firing's, in order, and its evidence a set at a time`, async () => {
      await withNotes(layer(), (notes) =>
        Effect.all([
          notes.keepIncident(incident),
          notes.addEvent({
            ...firing,
            ...event,
            id: "f1",
            at: firing.startsAt,
            recordedAt: firing.startsAt,
            kind: "fired",
            text: "warning",
          }),
          notes.addIncidentEvent({
            ...event,
            incident: "i1",
            id: "w1",
            at: "2026-10-12T14:05:00.000Z",
            recordedAt: "2026-10-12T14:31:00.000Z",
            source: "written",
            by: "gil",
            kind: "happened",
            text: "Rolled the registry back by hand",
          }),
          notes.addIncidentEvent({
            ...event,
            incident: "i1",
            id: "r1",
            at: "2026-10-12T13:58:20.000Z",
            recordedAt: "2026-10-12T14:03:00.000Z",
            source: "rebuilt",
            service: "petshop",
            text: "petshop 1.41.2 → 1.42.0 in production",
          }),
          notes.keepEvidence("i1", evidence("later", "2026-10-12T15:00:00.000Z")),
          notes.keepEvidence("i1", evidence("first", "2026-10-12T14:40:00.000Z")),
        ]),
      )
      const [timeline, kept] = await withNotes(layer(), (notes) =>
        Effect.all([incidentTimeline(incident).pipe(Effect.provideService(Notes, notes)), notes.evidence("i1")]),
      )
      expect(timeline.map((each) => [each.id, each.source, each.recordedAt])).toEqual([
        ["r1", "rebuilt", "2026-10-12T14:03:00.000Z"],
        ["f1", "seen", "2026-10-12T14:02:11.000Z"],
        ["w1", "written", "2026-10-12T14:31:00.000Z"],
      ])
      expect(kept.map((each) => each.id)).toEqual(["first", "later"])
      expect(kept[0]?.logs?.[0]?.lines).toHaveLength(2000)
      expect(kept[0]?.logs?.[0]?.leftOut).toBe(182)
    })
  }
})
