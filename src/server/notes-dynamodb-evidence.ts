/**
 * An incident's evidence in the notes' DynamoDB table: an item a set, under a partition of the incident's, sorted by
 * when it was kept, the set as JSON in the item's text.
 */
import { Effect } from "effect"
import type { AwsJson } from "./aws/json"
import { dynamoFailure, scanItems } from "./notes-dynamodb-items"
import { type KeptEvidence, oldestFirst, setOf } from "./notes-evidence"

const pkOf = (incident: string) => `!evidence#${incident}`

export const dynamoEvidence = (dynamo: AwsJson, table: string): KeptEvidence => ({
  evidence: (incident) =>
    scanItems(dynamo, table, {
      FilterExpression: "begins_with(pk, :incident)",
      ExpressionAttributeValues: { ":incident": { S: pkOf(incident) } },
    }).pipe(
      Effect.map((items) =>
        oldestFirst(items.filter((item) => item.pk.S === pkOf(incident)).flatMap((item) => setOf(item.text.S))),
      ),
      Effect.mapError(dynamoFailure),
    ),
  keepEvidence: (incident, set) =>
    dynamo("PutItem", {
      TableName: table,
      Item: {
        pk: { S: pkOf(incident) },
        sk: { S: `${set.keptAt}#${set.id}` },
        id: { S: set.id },
        environment: { S: "*" },
        alert: { S: "-" },
        time: { S: set.keptAt },
        by: { S: set.keptBy },
        text: { S: JSON.stringify(set) },
      },
    }).pipe(Effect.asVoid, Effect.mapError(dynamoFailure)),
})
