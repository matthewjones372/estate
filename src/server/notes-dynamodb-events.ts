/**
 * A firing's events in the notes' DynamoDB table: the environment and alert as the partition key, the firing's start
 * and the event's time as the sort key, so a firing's events read in order. What the item has no field for, the
 * event's kind, text, link and whether an answer read logs, rides in its text as JSON. An incident's own events are
 * under a partition of the incident's, sorted by time.
 */
import { Effect, Option, Schema } from "effect"
import { EventKind, EventSource, type FiringEvent } from "../shared/timeline"
import type { AwsJson } from "./aws/json"
import { type DynamoItem, dynamoFailure, removeItems, scanItems } from "./notes-dynamodb-items"
import { type FiringEvents, type FiringKey, inOrder, type StoredEvent, type StoredIncidentEvent } from "./notes-events"
import { sameInstant } from "./time"

const prefix = "!event#"
const pkOf = (firing: FiringKey) => `${prefix}${firing.environment}#${firing.alert}#`
const incidentPk = (incident: string) => `!incident-event#${incident}`

const Rest = Schema.fromJsonString(
  Schema.Struct({
    kind: EventKind,
    text: Schema.String,
    link: Schema.optionalKey(Schema.String),
    readLogs: Schema.optionalKey(Schema.Boolean),
    at: Schema.String,
    recordedAt: Schema.optionalKey(Schema.String),
    source: Schema.optionalKey(EventSource),
    service: Schema.optionalKey(Schema.String),
  }),
)
const decodeRest = Schema.decodeUnknownOption(Rest)

// An item kept before events said where they came from was seen live, so it was kept when it happened.
const saidOf = (item: DynamoItem): ReadonlyArray<FiringEvent> =>
  Option.match(decodeRest(item.text.S), {
    onNone: () => [],
    onSome: ({ recordedAt, source, ...rest }) => [
      { id: item.id.S, by: item.by.S, ...rest, recordedAt: recordedAt ?? rest.at, source: source ?? "seen" },
    ],
  })

const eventOf = (item: DynamoItem): ReadonlyArray<StoredEvent> =>
  saidOf(item).map((event) => ({
    ...event,
    environment: item.environment.S,
    alert: item.alert.S,
    startsAt: item.time.S,
  }))

const textOf = (event: FiringEvent) => ({
  S: JSON.stringify({
    kind: event.kind,
    text: event.text,
    link: event.link,
    readLogs: event.readLogs,
    at: event.at,
    recordedAt: event.recordedAt,
    source: event.source,
    service: event.service,
  }),
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
        text: textOf(event),
      },
    }).pipe(Effect.asVoid, Effect.mapError(dynamoFailure)),
  incidentEvents: (incident) =>
    scanItems(dynamo, table, {
      FilterExpression: "begins_with(pk, :incident)",
      ExpressionAttributeValues: { ":incident": { S: incidentPk(incident) } },
    }).pipe(
      Effect.map((items) =>
        inOrder(
          items
            .filter((item) => item.pk.S === incidentPk(incident))
            .flatMap(
              (item): ReadonlyArray<StoredIncidentEvent> => saidOf(item).map((event) => ({ ...event, incident })),
            ),
        ),
      ),
      Effect.mapError(dynamoFailure),
    ),
  addIncidentEvent: (event) =>
    dynamo("PutItem", {
      TableName: table,
      Item: {
        pk: { S: incidentPk(event.incident) },
        sk: { S: `${event.at}#${event.id}` },
        id: { S: event.id },
        environment: { S: "*" },
        alert: { S: "-" },
        time: { S: event.at },
        by: { S: event.by },
        text: textOf(event),
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
