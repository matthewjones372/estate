/**
 * What a span through a message broker says of its message, by OpenTelemetry's messaging conventions (spec 0057), and
 * the attribute names it is read under: the current names, or a store's own where its instrumentation is older.
 */
import { Schema } from "effect"

const optional = Schema.optionalKey

/** Where a store's spans keep each of these, in place of OpenTelemetry's current name. */
export const MessageNames = Schema.Struct({
  system: optional(Schema.String),
  operation: optional(Schema.String),
  topic: optional(Schema.String),
  partition: optional(Schema.String),
  offset: optional(Schema.String),
  key: optional(Schema.String),
  id: optional(Schema.String),
  group: optional(Schema.String),
})
export type MessageNames = typeof MessageNames.Type

const current: Required<MessageNames> = {
  system: "messaging.system",
  operation: "messaging.operation.type",
  topic: "messaging.destination.name",
  partition: "messaging.destination.partition.id",
  offset: "messaging.kafka.offset",
  key: "messaging.kafka.message.key",
  id: "messaging.message.id",
  group: "messaging.consumer.group.name",
}

/** Every name in use: a store's own where it gives one, the current convention's otherwise. */
export const messageNames = (own: MessageNames | undefined): Required<MessageNames> => ({ ...current, ...own })

const operations = ["create", "send", "receive", "process", "settle"] as const

export const Messaging = Schema.Struct({
  system: optional(Schema.String),
  operation: optional(Schema.Literals(operations)),
  /** The destination: a Kafka topic. */
  topic: optional(Schema.String),
  partition: optional(Schema.Number),
  offset: optional(Schema.Number),
  key: optional(Schema.String),
  id: optional(Schema.String),
  /** The consumer group, on a consumer's span. */
  group: optional(Schema.String),
})
export type Messaging = typeof Messaging.Type

const whole = (text: string | undefined) => {
  const value = text === undefined || text.trim() === "" ? Number.NaN : Number(text)
  return Number.isFinite(value) ? value : undefined
}

/** What a span's attributes, as text by name, say of its message; undefined when they say nothing. */
export const messagingOf = (
  attributes: ReadonlyMap<string, string>,
  names: Required<MessageNames>,
): Messaging | undefined => {
  const at = (field: keyof MessageNames) => attributes.get(names[field])
  const read = {
    system: at("system"),
    operation: operations.find((each) => each === at("operation")),
    topic: at("topic"),
    partition: whole(at("partition")),
    offset: whole(at("offset")),
    key: at("key"),
    id: at("id"),
    group: at("group"),
  }
  const said = Object.fromEntries(Object.entries(read).filter(([, value]) => value !== undefined)) as Messaging
  return Object.keys(said).length === 0 ? undefined : said
}
