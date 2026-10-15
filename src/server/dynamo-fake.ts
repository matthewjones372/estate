/** DynamoDB in memory, and the notes kept in it, for the notes' tests. */
import { ConfigProvider, Effect, Layer } from "effect"
import { Notes, type Notes as NotesService, type StoredNote } from "./notes"
import { dynamodbNotes } from "./notes-dynamodb"
import { platform } from "./platform"
import { type Call, liveRemote, type Remote, type Reply, reply } from "./remote"

type Item = Record<string, { readonly S: string }>

/**
 * Whether an item passes a scan's filter, as the notes write them: `begins_with(pk, :x)`, `id = :x`, `#time < :x`
 * and `#time >= :x`, joined by AND. A clause it does not know keeps every item.
 */
const passes = (item: Item, filter: string | undefined, values: Item): boolean =>
  (filter ?? "").split(" AND ").every((clause) => {
    const begins = /^begins_with\(pk, (:\w+)\)$/.exec(clause)
    if (begins !== null) return (item["pk"]?.S ?? "").startsWith(values[begins[1] ?? ""]?.S ?? "")
    const [, field, operator, name] = /^(id|#time) (=|<|>=) (:\w+)$/.exec(clause) ?? []
    if (field === undefined || name === undefined) return true
    const held = item[field === "#time" ? "time" : field]?.S ?? ""
    const value = values[name]?.S ?? ""
    return operator === "=" ? held === value : operator === "<" ? held < value : held >= value
  })

/** The little of DynamoDB the notes use, in memory: tables made slowly, scans two items a page, items of 400 KB at most. */
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
    if (operation === "PutItem" && JSON.stringify(body.Item).length > 400 * 1024)
      return refusal("ValidationException", "Item size has exceeded the maximum allowed size")
    if (operation === "PutItem") table.items.set(keyOf(body.Item), body.Item)
    if (operation === "DeleteItem") table.items.delete(keyOf(body.Key))
    if (operation === "Scan") {
      const values = body.ExpressionAttributeValues ?? {}
      const kept = [...table.items.values()].filter((item) => passes(item, body.FilterExpression, values))
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
