/** DynamoDB in memory, and the notes kept in it, for the notes' tests. */
import { ConfigProvider, Effect, Layer } from "effect"
import { Notes, type Notes as NotesService, type StoredNote } from "./notes"
import { dynamodbNotes } from "./notes-dynamodb"
import { platform } from "./platform"
import { type Call, liveRemote, type Remote, type Reply, reply } from "./remote"

type Item = Record<string, { readonly S: string }>

/** The little of DynamoDB the notes use, in memory: tables made slowly, scans two items a page. */
export const fakeDynamo = (calls: Call[], refuse?: string) => {
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
                  : String(body.FilterExpression).startsWith("begins_with(pk, :thread)")
                    ? (item["pk"]?.S ?? "").startsWith(values[":thread"].S)
                    : true,
      )
      const from = Number(body.ExclusiveStartKey?.index ?? 0)
      const next = from + 2 < kept.length ? { LastEvaluatedKey: { index: from + 2 } } : {}
      return reply({ Items: kept.slice(from, from + 2), ...next })
    }
    return reply("")
  }
}

export const note = (id: string, at: string, environment = "production"): StoredNote => ({
  id,
  environment,
  alert: "a1",
  at,
  by: "ada",
  text: `note ${id}`,
})

const keys = ConfigProvider.fromUnknown({ AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "secret" })

/** What `use` makes of notes kept in DynamoDB, reached through `remote`, as a result; a test runs it. */
export const usingNotes = <A>(
  use: (notes: NotesService) => Effect.Effect<A, { readonly message: string }>,
  remote: Layer.Layer<Remote> = liveRemote,
  endpoint?: string,
  environment = keys,
) =>
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
  )
