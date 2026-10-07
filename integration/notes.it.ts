import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { ConfigProvider, Effect, Layer, Redacted } from "effect"
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers"
import { Notes, type Notes as NotesService, type StoredNote } from "../src/server/notes"
import { dynamodbNotes } from "../src/server/notes-dynamodb"
import { platform } from "../src/server/platform"
import { notesInPostgres, postgresLayer } from "../src/server/postgres"
import { liveRemote } from "../src/server/remote"
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
  }
})
