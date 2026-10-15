/**
 * Notes kept in a DynamoDB table, for an estate on AWS with no database of its own: the environment and alert as the
 * partition key, the time as the sort key. The table is made, paid per request, if it is not there and the role may.
 */
import { Effect, Layer, Option, Schedule, Schema } from "effect"
import { makeAwsJson } from "./aws/json"
import { Notes, NotesError, type StoredFiring, type StoredImpact, type StoredNote, type StoredThread } from "./notes"
import { dynamoEvents, sweepDynamoEvents } from "./notes-dynamodb-events"
import { dynamoEvidence } from "./notes-dynamodb-evidence"
import { dynamoIncidents, sweepDynamoIncidents } from "./notes-dynamodb-incidents"
import { type Dynamo, dynamoDb, dynamoFailure, type Item, removeItems, scanItems } from "./notes-dynamodb-items"
import { SourceFailure } from "./sources/run"

export interface DynamoNotes {
  readonly table: string
  readonly region: string
  /** Somewhere other than the region's DynamoDB: DynamoDB Local, say. */
  readonly endpoint?: string
}

const kept = 200

const Described = Schema.Struct({ Table: Schema.Struct({ TableStatus: Schema.String }) })
const decodeDescribed = Schema.decodeUnknownEffect(Described)

const itemOf = (note: StoredNote) => ({
  pk: { S: `${note.environment}#${note.alert}` },
  sk: { S: `${note.at}#${note.id}` },
  id: { S: note.id },
  environment: { S: note.environment },
  alert: { S: note.alert },
  time: { S: note.at },
  by: { S: note.by },
  text: { S: note.text },
})

/** Items that are not notes, an alert's impact, say, have keys beginning with this, which no note's has. */
const other = "!"
const impactKey = (alert: string) => ({ pk: { S: `${other}impact#${alert}` }, sk: { S: "-" } })
const isNote = (item: typeof Item.Type) => !item.pk.S.startsWith(other)
const firingKey = (firing: StoredFiring) => ({
  pk: { S: `${other}firing#${firing.environment}#${firing.alert}` },
  sk: { S: firing.startsAt },
})

/** What of a firing the item has no field for, its end, silence reason and what it said, kept as JSON in its text. */
const Said = Schema.Struct({
  endsAt: Schema.optionalKey(Schema.String),
  reason: Schema.optionalKey(Schema.String),
  service: Schema.optionalKey(Schema.String),
  severity: Schema.optionalKey(Schema.String),
  summary: Schema.optionalKey(Schema.String),
  runbook: Schema.optionalKey(Schema.String),
  store: Schema.optionalKey(Schema.String),
})
const Rest = Schema.fromJsonString(Said)
const decodeRest = Schema.decodeUnknownOption(Rest)

const firingOf = (item: typeof Item.Type): StoredFiring => {
  const { endsAt, reason, ...said } = Option.getOrElse(decodeRest(item.text.S), (): typeof Said.Type => ({}))
  return {
    environment: item.environment.S,
    alert: item.alert.S,
    name: item.id.S,
    ...said,
    startsAt: item.time.S,
    ...(endsAt === undefined ? {} : { endsAt }),
    ...(item.by.S === "" ? {} : { silence: { by: item.by.S, reason: reason ?? "" } }),
  }
}

const noteOf = (item: typeof Item.Type): StoredNote => ({
  id: item.id.S,
  environment: item.environment.S,
  alert: item.alert.S,
  at: item.time.S,
  by: item.by.S,
  text: item.text.S,
})

/** The table, made and waited for when it is not there. */
const ensureTable = (dynamo: Dynamo, table: string) =>
  dynamo("DescribeTable", { TableName: table }).pipe(
    Effect.catchIf(
      (error) => error.type === "ResourceNotFoundException",
      () =>
        dynamo("CreateTable", {
          TableName: table,
          AttributeDefinitions: [
            { AttributeName: "pk", AttributeType: "S" },
            { AttributeName: "sk", AttributeType: "S" },
          ],
          KeySchema: [
            { AttributeName: "pk", KeyType: "HASH" },
            { AttributeName: "sk", KeyType: "RANGE" },
          ],
          BillingMode: "PAY_PER_REQUEST",
        }).pipe(
          Effect.mapError((error) =>
            error.type === "AccessDeniedException"
              ? new NotesError({
                  message: `the notes table ${table} is not there, and Estate may not make it: ${error.message}`,
                })
              : error,
          ),
          Effect.andThen(
            dynamo("DescribeTable", { TableName: table }).pipe(
              Effect.flatMap(decodeDescribed),
              Effect.filterOrFail(
                (described) => described.Table.TableStatus === "ACTIVE",
                () => new SourceFailure({ message: `the notes table ${table} is still being made` }),
              ),
              Effect.retry({ schedule: Schedule.spaced("1 second"), times: 60 }),
            ),
          ),
        ),
    ),
    Effect.mapError((error) =>
      error._tag === "NotesError" ? error : new NotesError({ message: `the notes table ${table}: ${error.message}` }),
    ),
  )

export const dynamodbNotes = (settings: DynamoNotes) =>
  Layer.effect(Notes)(
    Effect.gen(function* () {
      const dynamo = yield* makeAwsJson(dynamoDb, settings.region, settings.endpoint)
      const { table } = settings
      yield* ensureTable(dynamo, table)
      return {
        ...dynamoEvents(dynamo, table),
        ...dynamoIncidents(dynamo, table),
        ...dynamoEvidence(dynamo, table),
        all: scanItems(dynamo, table, {}).pipe(
          Effect.map((items) =>
            items
              .filter(isNote)
              .map(noteOf)
              .sort((a, b) => b.at.localeCompare(a.at))
              .slice(0, kept),
          ),
          Effect.mapError(dynamoFailure),
        ),
        add: (note: StoredNote) =>
          dynamo("PutItem", { TableName: table, Item: itemOf(note) }).pipe(
            Effect.asVoid,
            Effect.mapError(dynamoFailure),
          ),
        remove: (id: string) =>
          scanItems(dynamo, table, {
            FilterExpression: "id = :id",
            ExpressionAttributeValues: { ":id": { S: id } },
          }).pipe(
            Effect.flatMap((items) => removeItems(dynamo, table, items.filter(isNote))),
            Effect.mapError(dynamoFailure),
          ),
        removeBefore: (at: string) =>
          scanItems(dynamo, table, {
            FilterExpression: "#time < :at",
            ExpressionAttributeNames: { "#time": "time" },
            ExpressionAttributeValues: { ":at": { S: at } },
          }).pipe(
            Effect.flatMap((items) => removeItems(dynamo, table, items.filter(isNote))),
            Effect.mapError(dynamoFailure),
          ),
        impacts: scanItems(dynamo, table, {
          FilterExpression: "begins_with(pk, :impact)",
          ExpressionAttributeValues: { ":impact": { S: `${other}impact#` } },
        }).pipe(
          Effect.map((items) =>
            items.map((item) => ({ alert: item.alert.S, text: item.text.S, by: item.by.S, at: item.time.S })),
          ),
          Effect.mapError(dynamoFailure),
        ),
        setImpact: (impact: StoredImpact) =>
          (impact.text === ""
            ? dynamo("DeleteItem", { TableName: table, Key: impactKey(impact.alert) })
            : dynamo("PutItem", {
                TableName: table,
                Item: {
                  ...impactKey(impact.alert),
                  id: { S: `impact#${impact.alert}` },
                  environment: { S: "*" },
                  alert: { S: impact.alert },
                  time: { S: impact.at },
                  by: { S: impact.by },
                  text: { S: impact.text },
                },
              })
          ).pipe(Effect.asVoid, Effect.mapError(dynamoFailure)),
        firings: (since: string) =>
          scanItems(dynamo, table, {
            FilterExpression: "begins_with(pk, :firing) AND #time >= :since",
            ExpressionAttributeNames: { "#time": "time" },
            ExpressionAttributeValues: { ":firing": { S: `${other}firing#` }, ":since": { S: since } },
          }).pipe(
            Effect.map((items) => items.map(firingOf).toSorted((a, b) => b.startsAt.localeCompare(a.startsAt))),
            Effect.mapError(dynamoFailure),
          ),
        keepFiring: (firing: StoredFiring) =>
          dynamo("PutItem", {
            TableName: table,
            Item: {
              ...firingKey(firing),
              id: { S: firing.name },
              environment: { S: firing.environment },
              alert: { S: firing.alert },
              time: { S: firing.startsAt },
              by: { S: firing.silence?.by ?? "" },
              text: {
                S: JSON.stringify({
                  endsAt: firing.endsAt,
                  reason: firing.silence?.reason,
                  service: firing.service,
                  severity: firing.severity,
                  summary: firing.summary,
                  runbook: firing.runbook,
                  store: firing.store,
                }),
              },
            },
          }).pipe(Effect.asVoid, Effect.mapError(dynamoFailure)),
        removeFiringsBefore: (at: string) =>
          scanItems(dynamo, table, {
            FilterExpression: "begins_with(pk, :firing) AND #time < :at",
            ExpressionAttributeNames: { "#time": "time" },
            ExpressionAttributeValues: { ":firing": { S: `${other}firing#` }, ":at": { S: at } },
          }).pipe(
            Effect.flatMap((items) => removeItems(dynamo, table, items)),
            Effect.mapError(dynamoFailure),
            Effect.andThen(sweepDynamoEvents(dynamo, table, at)),
            Effect.andThen(sweepDynamoIncidents(dynamo, table, at)),
          ),
        // A thread's channel and URL ride in the item's `by` and `text`, its timestamp in `id`.
        threads: (since: string) =>
          scanItems(dynamo, table, {
            FilterExpression: "begins_with(pk, :thread) AND #time >= :since",
            ExpressionAttributeNames: { "#time": "time" },
            ExpressionAttributeValues: { ":thread": { S: `${other}thread#` }, ":since": { S: since } },
          }).pipe(
            Effect.map((items) =>
              items.map((item) => ({
                environment: item.environment.S,
                alert: item.alert.S,
                startsAt: item.time.S,
                channel: item.by.S,
                ts: item.id.S,
                url: item.text.S,
              })),
            ),
            Effect.mapError(dynamoFailure),
          ),
        keepThread: (thread: StoredThread) =>
          dynamo("PutItem", {
            TableName: table,
            Item: {
              pk: { S: `${other}thread#${thread.environment}#${thread.alert}` },
              sk: { S: thread.startsAt },
              id: { S: thread.ts },
              environment: { S: thread.environment },
              alert: { S: thread.alert },
              time: { S: thread.startsAt },
              by: { S: thread.channel },
              text: { S: thread.url },
            },
          }).pipe(Effect.asVoid, Effect.mapError(dynamoFailure)),
      }
    }),
  )
