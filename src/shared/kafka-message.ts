/**
 * One message followed through a Kafka store (spec 0057): where its producer span says it was written, and for each
 * group reading its topic, whether a consumer span says it read it, or else where the group's committed offset is.
 */
import { Result, Schema } from "effect"
import type { Reading } from "./kafka-cluster"
import type { MessageNames } from "./messaging"
import type { TraceSpan } from "./traces"

const Written = Schema.Struct({
  service: Schema.String,
  topic: Schema.String,
  partition: Schema.Number,
  offset: Schema.Number,
  key: Schema.optionalKey(Schema.String),
  id: Schema.optionalKey(Schema.String),
  /** When the producer's span ended, in milliseconds since the epoch. */
  at: Schema.Number,
})
export type Written = typeof Written.Type

const Group = Schema.Union([
  /** A consumer span of the group's handled it: which service, when, and how long after it was written. */
  Schema.Struct({
    name: Schema.String,
    state: Schema.Literal("read"),
    service: Schema.String,
    at: Schema.Number,
    after: Schema.Number,
  }),
  /** Its committed offset on the partition is not past the message: how many are before it, and how long at its rate. */
  Schema.Struct({
    name: Schema.String,
    state: Schema.Literal("not yet"),
    offset: Schema.Number,
    before: Schema.Number,
    seconds: Schema.NullOr(Schema.Number),
  }),
  /** Its committed offset is past the message, but no span says a traced consumer handled it. */
  Schema.Struct({ name: Schema.String, state: Schema.Literal("past it"), offset: Schema.Number }),
  /** It reads the topic, but the exporter has no offset for it on this partition. */
  Schema.Struct({ name: Schema.String, state: Schema.Literal("unknown") }),
])
type FollowedGroup = typeof Group.Type

export const FollowedMessage = Schema.Struct({
  trace: Schema.String,
  readAt: Schema.String,
  written: Written,
  groups: Schema.Array(Group),
  /** Every group has read it or is past it: nothing more to wait for. */
  done: Schema.Boolean,
  /** Attributes a consumer span on the message lacked, so it could not be placed in a group. */
  missing: Schema.Array(Schema.String),
})
export type FollowedMessage = typeof FollowedMessage.Type

/** A span with the trace it is in. */
export interface Found {
  readonly trace: string
  readonly span: TraceSpan
}

/** kafka_exporter's series a followed message is compared with: each group's committed offsets, narrowed to its topic. */
export const messageQueries = (selector: string, topic: string, partition: number) => {
  const on = `${selector},topic=${JSON.stringify(topic)}`
  return {
    offsets: `kafka_consumergroup_current_offset{${on}}`,
    rates: `sum by (consumergroup) (rate(kafka_consumergroup_current_offset{${on},partition="${partition}"}[5m]))`,
  } as const
}

const sends = (span: TraceSpan) =>
  span.kind === "producer" || span.messaging?.operation === "send" || span.messaging?.operation === "create"

const reads = (span: TraceSpan) =>
  span.kind === "consumer" || span.messaging?.operation === "process" || span.messaging?.operation === "receive"

/** The message's producer span, the first in time, or why there is none; one with this ID where one is asked for. */
export const writtenOf = (
  found: ReadonlyArray<Found>,
  names: Required<MessageNames>,
  asked: { readonly trace?: string; readonly id?: string },
): Result.Result<Found & { readonly written: Written }, string> => {
  const producers = found
    .filter(({ span }) => sends(span) && span.messaging?.topic !== undefined)
    .filter(({ span }) => asked.id === undefined || span.messaging?.id === asked.id)
    .sort((a, b) => a.span.start - b.span.start)
  const first = producers[0]
  const where = asked.trace === undefined ? "" : ` in trace ${asked.trace}`
  if (first === undefined)
    return Result.fail(
      asked.id === undefined
        ? `no producer span${where} carries ${names.topic}`
        : `no producer span${where} carries ${names.id} = ${JSON.stringify(asked.id)}`,
    )
  const { span } = first
  const { topic = "", partition, offset, key, id } = span.messaging ?? {}
  const lacking = [partition === undefined ? names.partition : [], offset === undefined ? names.offset : []].flat()
  if (partition === undefined || offset === undefined)
    return Result.fail(`${span.service}'s producer span ${span.name} has no ${lacking.join(" or ")}`)
  return Result.succeed({
    ...first,
    written: {
      service: span.service,
      topic,
      partition,
      offset,
      ...(key === undefined ? {} : { key }),
      ...(id === undefined ? {} : { id }),
      at: span.end,
    },
  })
}

/** A consumer span that could be about this message: nothing it says contradicts where the message was written. */
const about = (span: TraceSpan, written: Written) => {
  const said = span.messaging ?? {}
  return (
    reads(span) &&
    (said.topic === undefined || said.topic === written.topic) &&
    (said.partition === undefined || said.partition === written.partition) &&
    (said.offset === undefined || said.offset === written.offset) &&
    (said.id === undefined || written.id === undefined || said.id === written.id)
  )
}

/** Each group reading the topic, or with a span for it, as read, not yet, past it or unknown, by name. */
export const followedFrom = (
  trace: string,
  written: Written,
  found: ReadonlyArray<Found>,
  readings: { readonly offsets: ReadonlyArray<Reading>; readonly rates: ReadonlyArray<Reading> },
  names: Required<MessageNames>,
  now: number,
): FollowedMessage => {
  const consumers = found.map(({ span }) => span).filter((span) => about(span, written))
  const spanOf = new Map<string, TraceSpan>()
  for (const span of [...consumers].sort((a, b) => b.start - a.start)) {
    if (span.messaging?.group !== undefined) spanOf.set(span.messaging.group, span)
  }
  const groupOf = (labels: Readonly<Record<string, string>>) => labels["consumergroup"] ?? ""
  const offsets = new Map(
    readings.offsets
      .filter(({ labels }) => labels["partition"] === String(written.partition))
      .map(({ labels, value }) => [groupOf(labels), value]),
  )
  const rates = new Map(readings.rates.map(({ labels, value }) => [groupOf(labels), value]))
  const named = [...new Set([...readings.offsets.map(({ labels }) => groupOf(labels)), ...spanOf.keys()])]
  const groups = named.sort().map((name): FollowedGroup => {
    const span = spanOf.get(name)
    if (span !== undefined)
      return { name, state: "read", service: span.service, at: span.start, after: span.start - written.at }
    const offset = offsets.get(name)
    if (offset === undefined) return { name, state: "unknown" }
    // A committed offset is the next one the group will read, so it is past the message once it is beyond it.
    if (offset > written.offset) return { name, state: "past it", offset }
    const before = written.offset - offset
    const rate = rates.get(name) ?? 0
    return { name, state: "not yet", offset, before, seconds: rate > 0 ? Math.round(before / rate) : null }
  })
  return {
    trace,
    readAt: new Date(now).toISOString(),
    written,
    groups,
    done: groups.every((group) => group.state === "read" || group.state === "past it"),
    missing: consumers.some((span) => span.messaging?.group === undefined) ? [names.group] : [],
  }
}
