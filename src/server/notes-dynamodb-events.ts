/**
 * A firing's events in the notes' DynamoDB table: the environment and alert as the partition key, the firing's start
 * and the event's time as the sort key, so a firing's events read in order. What the item has no field for, the
 * event's kind, text, link and whether an answer read logs, rides in its text as JSON.
 */
import { Effect, Option, Schema } from "effect"
import { EventKind } from "../shared/timeline"
import type { AwsJson } from "./aws/json"
import { type DynamoItem, dynamoFailure, removeItems, scanItems } from "./notes-dynamodb-items"
import { type FiringEvents, type FiringKey, inOrder, type StoredEvent } from "./notes-events"
import { sameInstant } from "./time"

const prefix = "!event#"
const pkOf = (firing: FiringKey) => `${prefix}${firing.environment}#${firing.alert}#`

const Rest = Schema.fromJsonString(
  Schema.Struct({
    kind: EventKind,
    text: Schema.String,
    link: Schema.optionalKey(Schema.String),
    readLogs: Schema.optionalKey(Schema.Boolean),
    at: Schema.String,
  }),
)
const decodeRest = Schema.decodeUnknownOption(Rest)

const eventOf = (item: DynamoItem): ReadonlyArray<StoredEvent> =>
  Option.match(decodeRest(item.text.S), {
    onNone: () => [],
    onSome: ({ kind, text, link, readLogs, at }) => [
      {
        id: item.id.S,
        environment: item.environment.S,
        alert: item.alert.S,
        startsAt: item.time.S,
        at,
        by: item.by.S,
        kind,
        text,
        ...(link === undefined ? {} : { link }),
        ...(readLogs === undefined ? {} : { readLogs }),
      },
    ],
  })

export const dynamoEvents = (dynamo: AwsJson, table: string): FiringEvents => ({
  // `time` is the firing's start, matched as an instant: text compared would miss one written to the second.
  events: (firing) =>
    scanItems(dynamo, table, {
      FilterExpression: "begins_with(pk, :firing)",
      ExpressionAttributeValues: { ":firing": { S: pkOf(firing) } },
    }).pipe(
      Effect.map((items) =>
        inOrder(
          items
            .filter((item) => item.pk.S === pkOf(firing) && sameInstant(item.time.S, firing.startsAt))
            .flatMap(eventOf),
        ),
      ),
      Effect.mapError(dynamoFailure),
    ),
  addEvent: (event) =>
    dynamo("PutItem", {
      TableName: table,
      Item: {
        pk: { S: pkOf(event) },
        sk: { S: `${event.startsAt}#${event.at}#${event.id}` },
        id: { S: event.id },
        environment: { S: event.environment },
        alert: { S: event.alert },
        time: { S: event.startsAt },
        by: { S: event.by },
        text: {
          S: JSON.stringify({
            kind: event.kind,
            text: event.text,
            link: event.link,
            readLogs: event.readLogs,
            at: event.at,
          }),
        },
      },
    }).pipe(Effect.asVoid, Effect.mapError(dynamoFailure)),
})

/** The events of firings begun before `at`. */
export const sweepDynamoEvents = (dynamo: AwsJson, table: string, at: string) =>
  scanItems(dynamo, table, {
    FilterExpression: "begins_with(pk, :firing) AND #time < :at",
    ExpressionAttributeNames: { "#time": "time" },
    ExpressionAttributeValues: { ":firing": { S: prefix }, ":at": { S: at } },
  }).pipe(
    Effect.flatMap((items) => removeItems(dynamo, table, items)),
    Effect.mapError(dynamoFailure),
  )
