/**
 * An incident's evidence in the notes' DynamoDB table, under a partition of the incident's, sorted by when it was kept.
 * An item holds 400 KB, so each set is gzipped and split across items, each saying which part of how many it is, and
 * read back joined in order. A set kept whole as JSON, before sets were split, reads back as it was.
 */
import { gunzipSync, gzipSync } from "node:zlib"
import { Effect, Result } from "effect"
import type { EvidenceSet } from "../shared/evidence"
import type { AwsJson } from "./aws/json"
import { type DynamoItem, dynamoFailure, scanItems } from "./notes-dynamodb-items"
import { type KeptEvidence, oldestFirst, setOf } from "./notes-evidence"

const pkOf = (incident: string) => `!evidence#${incident}`

/** Characters of base64 an item carries, well under what it may hold with its keys. */
const part = 300_000

const partsOf = (set: EvidenceSet): ReadonlyArray<string> => {
  const packed = gzipSync(JSON.stringify(set)).toString("base64")
  return Array.from({ length: Math.max(1, Math.ceil(packed.length / part)) }, (_, index) =>
    packed.slice(index * part, (index + 1) * part),
  )
}

/** A set from its items: one whole JSON, or every part of it, in order; none when a part is missing or unreadable. */
const joined = (items: ReadonlyArray<DynamoItem>): ReadonlyArray<EvidenceSet> => {
  const [first] = items
  if (items.length === 1 && first?.text.S.startsWith("{") === true) return setOf(first.text.S)
  const parts = items.toSorted((a, b) => Number(a.alert.S.split("/")[0]) - Number(b.alert.S.split("/")[0]))
  if (parts.length !== Number(first?.alert.S.split("/")[1])) return []
  const packed = parts.map((item) => item.text.S).join("")
  const text = Result.getOrUndefined(Result.try(() => gunzipSync(Buffer.from(packed, "base64")).toString()))
  return text === undefined ? [] : setOf(text)
}

export const dynamoEvidence = (dynamo: AwsJson, table: string): KeptEvidence => ({
  evidence: (incident) =>
    scanItems(dynamo, table, {
      FilterExpression: "begins_with(pk, :incident)",
      ExpressionAttributeValues: { ":incident": { S: pkOf(incident) } },
    }).pipe(
      Effect.map((items) => {
        const sets = Map.groupBy(
          items.filter((item) => item.pk.S === pkOf(incident)),
          (item) => item.id.S,
        )
        return oldestFirst([...sets.values()].flatMap(joined))
      }),
      Effect.mapError(dynamoFailure),
    ),
  keepEvidence: (incident, set) => {
    const parts = partsOf(set)
    return Effect.forEach(
      parts,
      (text, index) =>
        dynamo("PutItem", {
          TableName: table,
          Item: {
            pk: { S: pkOf(incident) },
            sk: { S: `${set.keptAt}#${set.id}#${String(index).padStart(4, "0")}` },
            id: { S: set.id },
            environment: { S: "*" },
            alert: { S: `${index}/${parts.length}` },
            time: { S: set.keptAt },
            by: { S: set.keptBy },
            text: { S: text },
          },
        }),
      { discard: true },
    ).pipe(Effect.mapError(dynamoFailure))
  },
})
