/**
 * Incidents in the notes' DynamoDB table: one item each, under a partition of their own with the id as the sort key,
 * the time it opened as the item's time, and the rest of it as JSON in the item's text.
 */
import { Effect } from "effect"
import type { AwsJson } from "./aws/json"
import { dynamoFailure, removeItems, scanItems } from "./notes-dynamodb-items"
import { incidentOf, type KeptIncidents, restOf } from "./notes-incidents"

const pk = "!incident#"

export const dynamoIncidents = (dynamo: AwsJson, table: string): KeptIncidents => ({
  incidents: (since) =>
    scanItems(dynamo, table, {
      FilterExpression: "begins_with(pk, :incident) AND #time >= :since",
      ExpressionAttributeNames: { "#time": "time" },
      ExpressionAttributeValues: { ":incident": { S: pk }, ":since": { S: since } },
    }).pipe(
      Effect.map((items) =>
        items
          .flatMap((item) => incidentOf(item.id.S, item.time.S, item.text.S))
          .toSorted((a, b) => b.openedAt.localeCompare(a.openedAt)),
      ),
      Effect.mapError(dynamoFailure),
    ),
  keepIncident: (incident) =>
    dynamo("PutItem", {
      TableName: table,
      Item: {
        pk: { S: pk },
        sk: { S: incident.id },
        id: { S: incident.id },
        environment: { S: "*" },
        alert: { S: "-" },
        time: { S: incident.openedAt },
        by: { S: incident.openedBy },
        text: { S: restOf(incident) },
      },
    }).pipe(Effect.asVoid, Effect.mapError(dynamoFailure)),
})

const under = (dynamo: AwsJson, table: string, partition: string) =>
  scanItems(dynamo, table, {
    FilterExpression: "begins_with(pk, :partition)",
    ExpressionAttributeValues: { ":partition": { S: partition } },
  }).pipe(Effect.map((items) => items.filter((item) => item.pk.S === partition)))

/** The incidents opened before `at`, with their own events and evidence. */
export const sweepDynamoIncidents = (dynamo: AwsJson, table: string, at: string) =>
  scanItems(dynamo, table, {
    FilterExpression: "begins_with(pk, :incident) AND #time < :at",
    ExpressionAttributeNames: { "#time": "time" },
    ExpressionAttributeValues: { ":incident": { S: pk }, ":at": { S: at } },
  }).pipe(
    Effect.flatMap((incidents) =>
      Effect.forEach(incidents, (incident) =>
        Effect.all([
          under(dynamo, table, `!incident-event#${incident.id.S}`),
          under(dynamo, table, `!evidence#${incident.id.S}`),
        ]),
      ).pipe(Effect.flatMap((held) => removeItems(dynamo, table, [...held.flat(2), ...incidents]))),
    ),
    Effect.mapError(dynamoFailure),
  )
