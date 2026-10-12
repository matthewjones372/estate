/** The notes table's items, as DynamoDB holds them, and reading and removing them a page at a time. */
import { Effect, Option, Schema, Stream } from "effect"
import type { AwsCallError, AwsJson } from "./aws/json"
import { SourceFailure } from "./sources/run"

const Text = Schema.Struct({ S: Schema.String })
export const Item = Schema.Struct({
  pk: Text,
  sk: Text,
  id: Text,
  environment: Text,
  alert: Text,
  time: Text,
  by: Text,
  text: Text,
})
const Page = Schema.Struct({
  Items: Schema.Array(Item),
  LastEvaluatedKey: Schema.optionalKey(Schema.Unknown),
})
const decodePage = Schema.decodeUnknownEffect(Page)
export type DynamoItem = typeof Item.Type

export type Dynamo = AwsJson

export const dynamoDb = { service: "dynamodb", target: "DynamoDB_20120810", version: "1.0", name: "DynamoDB" } as const

export const dynamoFailure = (error: AwsCallError | Schema.SchemaError) =>
  new SourceFailure({ message: `the notes table: ${error.message}` })

/** Every item that `filter` keeps, page by page. */
export const scanItems = (
  dynamo: Dynamo,
  table: string,
  filter: object,
): Effect.Effect<ReadonlyArray<typeof Item.Type>, AwsCallError | Schema.SchemaError> =>
  Stream.paginate(undefined as unknown, (from) =>
    dynamo("Scan", { TableName: table, ...filter, ...(from === undefined ? {} : { ExclusiveStartKey: from }) }).pipe(
      Effect.flatMap(decodePage),
      Effect.map((page) => [page.Items, Option.fromUndefinedOr(page.LastEvaluatedKey)] as const),
    ),
  ).pipe(Stream.runCollect)

export const removeItems = (dynamo: Dynamo, table: string, items: ReadonlyArray<typeof Item.Type>) =>
  Effect.forEach(items, (item) => dynamo("DeleteItem", { TableName: table, Key: { pk: item.pk, sk: item.sk } }), {
    concurrency: 4,
    discard: true,
  })
