import { describe, expect, test } from "bun:test"
import { ConfigProvider, Effect, Layer, Result } from "effect"
import { Notes, type Notes as NotesService, type StoredNote } from "./notes"
import { dynamodbNotes } from "./notes-dynamodb"
import { platform } from "./platform"
import { type Call, liveRemote, Remote, RemoteError, type Reply, reply, stubRemote } from "./remote"

type Item = Record<string, { readonly S: string }>

/** The little of DynamoDB the notes use, in memory: tables made slowly, scans two items a page. */
const fakeDynamo = (calls: Call[], refuse?: string) => {
  const tables = new Map<string, { described: number; items: Map<string, Item> }>()
  const refusal = (type: string, message: string) =>
    reply({ __type: `com.amazonaws.dynamodb.v20120810#${type}`, message }, 400)
  return (call: Call): Reply => {
    calls.push(call)
    const operation = call.headers?.["x-amz-target"]?.split(".")[1] ?? ""
    const body = JSON.parse(call.body ?? "{}")
    const table = tables.get(body.TableName)
    if (operation === refuse) return refusal("AccessDeniedException", `not allowed to ${operation}`)
    if (operation === "DescribeTable") {
      if (table === undefined) return refusal("ResourceNotFoundException", "no such table")
      table.described += 1
      return reply({ Table: { TableStatus: table.described > 2 ? "ACTIVE" : "CREATING" } })
    }
    if (operation === "CreateTable") {
      tables.set(body.TableName, { described: 0, items: new Map() })
      return reply({})
    }
    if (table === undefined) return refusal("ResourceNotFoundException", "no such table")
    const keyOf = (key: Item) => `${key["pk"]?.S}|${key["sk"]?.S}`
    if (operation === "PutItem") table.items.set(keyOf(body.Item), body.Item)
    if (operation === "DeleteItem") table.items.delete(keyOf(body.Key))
    if (operation === "Scan") {
      const values = body.ExpressionAttributeValues ?? {}
      const kept = [...table.items.values()].filter((item) =>
        body.FilterExpression === "id = :id"
          ? item["id"]?.S === values[":id"].S
          : body.FilterExpression === "#time < :at"
            ? (item["time"]?.S ?? "") < values[":at"].S
            : body.FilterExpression === "begins_with(pk, :impact)"
              ? (item["pk"]?.S ?? "").startsWith(values[":impact"].S)
              : body.FilterExpression === "begins_with(pk, :firing) AND #time >= :since"
                ? (item["pk"]?.S ?? "").startsWith(values[":firing"].S) && (item["time"]?.S ?? "") >= values[":since"].S
                : body.FilterExpression === "begins_with(pk, :firing) AND #time < :at"
                  ? (item["pk"]?.S ?? "").startsWith(values[":firing"].S) && (item["time"]?.S ?? "") < values[":at"].S
                  : true,
      )
      const from = Number(body.ExclusiveStartKey?.index ?? 0)
      const next = from + 2 < kept.length ? { LastEvaluatedKey: { index: from + 2 } } : {}
      return reply({ Items: kept.slice(from, from + 2), ...next })
    }
    return reply("")
  }
}

const note = (id: string, at: string, environment = "production"): StoredNote => ({
  id,
  environment,
  alert: "a1",
  at,
  by: "ada",
  text: `note ${id}`,
})

const keys = ConfigProvider.fromUnknown({ AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "secret" })

const withNotes = <A>(
  use: (notes: NotesService) => Effect.Effect<A, { readonly message: string }>,
  remote: Layer.Layer<Remote> = liveRemote,
  endpoint?: string,
  environment = keys,
) =>
  Effect.runPromise(
    Effect.result(
      Effect.gen(function* () {
        return yield* use(yield* Notes)
      }).pipe(
        Effect.provide(
          dynamodbNotes({
            table: "estate-notes",
            region: "eu-west-2",
            ...(endpoint === undefined ? {} : { endpoint }),
          }).pipe(Layer.provide([remote, platform])),
        ),
        Effect.provideService(ConfigProvider.ConfigProvider, environment),
      ),
    ),
  )

describe("impacts in DynamoDB", () => {
  test("are kept beside the notes, one an alert, and neither read nor swept as notes", () => {
    const calls: Call[] = []
    const impact = { alert: "OrdersSlow", text: "Orders take minutes to place.", by: "ada", at: "2026-10-03T12:00:00Z" }
    return withNotes(
      (notes) =>
        Effect.gen(function* () {
          yield* notes.add(note("n1", "2026-10-01T00:00:00Z"))
          yield* notes.setImpact(impact)
          yield* notes.setImpact({ ...impact, text: "Orders fail.", at: "2026-10-03T13:00:00Z" })
          yield* notes.setImpact({
            alert: "SearchSlow",
            text: "Search is slow.",
            by: "gil",
            at: "2026-10-01T00:00:00Z",
          })
          yield* notes.removeBefore("2026-10-02T00:00:00Z")
          const kept = { impacts: yield* notes.impacts, notes: yield* notes.all }
          yield* notes.setImpact({ ...impact, text: "" })
          return { ...kept, after: yield* notes.impacts }
        }),
      stubRemote(fakeDynamo(calls)),
    ).then((result) => {
      const read = Result.isSuccess(result) ? result.success : undefined
      expect(read?.impacts.map((each) => [each.alert, each.text]).sort()).toEqual([
        ["OrdersSlow", "Orders fail."],
        ["SearchSlow", "Search is slow."],
      ])
      expect(read?.notes).toEqual([])
      expect(read?.after.map((each) => each.alert)).toEqual(["SearchSlow"])
    })
  })
})

describe("firings in DynamoDB", () => {
  test("are kept beside the notes, a firing's end and silence written over its start, and swept by their time", () => {
    const calls: Call[] = []
    const firing = {
      environment: "production",
      alert: "a1",
      name: "OrdersSlow",
      service: "orders",
      startsAt: "2026-10-02T10:00:00Z",
    }
    return withNotes(
      (notes) =>
        Effect.gen(function* () {
          yield* notes.add(note("n1", "2026-10-02T10:01:00Z"))
          yield* notes.keepFiring(firing)
          yield* notes.keepFiring({
            ...firing,
            endsAt: "2026-10-02T10:20:00Z",
            silence: { by: "gil", reason: "deploy" },
          })
          yield* notes.keepFiring({ ...firing, startsAt: "2026-09-01T10:00:00Z" })
          const read = yield* notes.firings("2026-09-15T00:00:00Z")
          yield* notes.removeFiringsBefore("2026-09-15T00:00:00Z")
          return { read, left: yield* notes.firings("2026-01-01T00:00:00Z"), notes: yield* notes.all }
        }),
      stubRemote(fakeDynamo(calls)),
    ).then((result) => {
      const done = Result.isSuccess(result) ? result.success : undefined
      expect(done?.read).toEqual([
        { ...firing, endsAt: "2026-10-02T10:20:00Z", silence: { by: "gil", reason: "deploy" } },
      ])
      expect(done?.left.map((each) => each.startsAt)).toEqual(["2026-10-02T10:00:00Z"])
      expect(done?.notes.map((each) => each.id)).toEqual(["n1"])
    })
  })
})

describe("notes in DynamoDB", () => {
  test("make the table on demand, and keep notes across a restart, newest first, signed for DynamoDB", () => {
    const calls: Call[] = []
    const dynamo = stubRemote(fakeDynamo(calls))
    return withNotes(
      (notes) =>
        Effect.forEach(
          [
            note("n1", "2026-10-03T11:00:00.000Z"),
            note("n2", "2026-10-03T11:05:00.000Z"),
            note("n3", "2026-10-03T11:10:00.000Z"),
          ],
          notes.add,
        ),
      dynamo,
    ).then((added) => {
      expect(Result.isSuccess(added)).toBe(true)
      expect(calls[0]?.url).toBe("https://dynamodb.eu-west-2.amazonaws.com/")
      expect(calls[0]?.headers?.["authorization"]).toStartWith("AWS4-HMAC-SHA256 Credential=test/")
      expect(calls.map((call) => call.headers?.["x-amz-target"]).slice(0, 5)).toEqual([
        "DynamoDB_20120810.DescribeTable",
        "DynamoDB_20120810.CreateTable",
        "DynamoDB_20120810.DescribeTable",
        "DynamoDB_20120810.DescribeTable",
        "DynamoDB_20120810.DescribeTable",
      ])
      return withNotes((notes) => notes.all, dynamo).then((all) => {
        expect(Result.isSuccess(all) && all.success.map((each) => each.id)).toEqual(["n3", "n2", "n1"])
      })
    })
  }, 10_000)

  test("remove a note by its id, and those written before a time", () => {
    const dynamo = stubRemote(fakeDynamo([]))
    return withNotes(
      (notes) =>
        Effect.gen(function* () {
          for (const each of [
            note("old", "2026-09-01T00:00:00.000Z", "staging"),
            note("n1", "2026-10-03T11:00:00.000Z"),
            note("n2", "2026-10-03T11:05:00.000Z"),
          ])
            yield* notes.add(each)
          yield* notes.remove("n1")
          yield* notes.removeBefore("2026-10-01T00:00:00.000Z")
          return yield* notes.all
        }),
      dynamo,
    ).then((left) => {
      expect(Result.isSuccess(left) && left.success.map((each) => each.id)).toEqual(["n2"])
    })
  }, 10_000)

  test("say so when the table is not there and Estate may not make it, or DynamoDB answers oddly", () =>
    Promise.all([
      withNotes((notes) => notes.all, stubRemote(fakeDynamo([], "CreateTable"))),
      withNotes((notes) => notes.all, stubRemote(fakeDynamo([], "DescribeTable"))),
      withNotes(
        (notes) => notes.all,
        stubRemote(() => reply("<html>", 502)),
      ),
      withNotes(
        (notes) => notes.all,
        stubRemote(() => reply("not json")),
      ),
    ]).then((results) => {
      const messages = results.map((result) => (Result.isFailure(result) ? result.failure.message : ""))
      expect(messages).toEqual([
        "the notes table estate-notes is not there, and Estate may not make it: not allowed to CreateTable",
        "the notes table estate-notes: not allowed to DescribeTable",
        "the notes table estate-notes: DynamoDB answered 502",
        "the notes table estate-notes: DynamoDB answered with no JSON",
      ])
    }))

  test("say so when a read or a write fails after the table is there", () => {
    let ready = false
    const dynamo = fakeDynamo([])
    const failing = (call: Call) => {
      const target = call.headers?.["x-amz-target"] ?? ""
      if (ready && !target.endsWith("DescribeTable"))
        return reply({ __type: "ProvisionedThroughputExceededException" }, 400)
      return dynamo(call)
    }
    return withNotes(
      (notes) =>
        Effect.gen(function* () {
          ready = true
          const each = [notes.all, notes.add(note("n", "t")), notes.remove("n"), notes.removeBefore("t")]
          return yield* Effect.all(each.map(Effect.asVoid), {
            mode: "result",
          })
        }),
      stubRemote(failing),
    ).then((result) => {
      const each = Result.isSuccess(result) ? result.success : []
      expect(each.map((one) => (Result.isFailure(one) ? one.failure.message : "ok"))).toEqual(
        Array(4).fill("the notes table: ProvisionedThroughputExceededException"),
      )
    })
  }, 10_000)

  test("say so when there are no credentials, or DynamoDB cannot be reached", () => {
    const unreachable = Layer.succeed(Remote)({
      call: (call) => Effect.fail(new RemoteError({ url: call.url, message: "could not reach dynamodb" })),
    })
    return Promise.all([
      withNotes((notes) => notes.all, stubRemote(fakeDynamo([])), undefined, ConfigProvider.fromUnknown({})),
      withNotes((notes) => notes.all, unreachable),
    ]).then(([keyless, gone]) => {
      expect(Result.isFailure(keyless) && keyless.failure.message).toStartWith(
        "the notes table estate-notes: no AWS credentials",
      )
      expect(Result.isFailure(gone) && gone.failure.message).toBe(
        "the notes table estate-notes: DynamoDB could not reach dynamodb",
      )
    })
  })

  // Against DynamoDB Local, when ESTATE_DYNAMODB_LOCAL names one (http://localhost:8000, say).
  const local = Bun.env["ESTATE_DYNAMODB_LOCAL"]
  test.skipIf(local === undefined)("survive a restart against DynamoDB Local", () =>
    withNotes((notes) => notes.add(note(`local-${Date.now()}`, new Date().toISOString())), liveRemote, local).then(
      (added) => {
        expect(Result.isSuccess(added)).toBe(true)
        return withNotes((notes) => notes.all, liveRemote, local).then((all) => {
          expect(Result.isSuccess(all) && all.success.some((each) => each.id.startsWith("local-"))).toBe(true)
        })
      },
    ),
  )
})
