/** The `feed` event: what changed in the last day in an environment, each change saying what it is about. */
import { Schema } from "effect"

const optional = Schema.optionalKey
const Instant = Schema.String

export const FeedItem = Schema.Struct({
  at: Instant,
  kind: Schema.Literals(["deploy", "build", "alert", "resolved", "silence", "note", "debug", "job"]),
  service: optional(Schema.String),
  text: Schema.String,
  who: optional(Schema.String),
  url: optional(Schema.String),
  /** The past firing an item is about, so it opens that firing's page: one resolved, or one a note was written on. */
  firing: optional(Schema.Struct({ alert: Schema.String, startsAt: Instant })),
  /** The alert, by its id, an item is about while it fires, so it opens the alert's page. */
  alert: optional(Schema.String),
  /** The name of the alert a note was written on, which the line says. */
  on: optional(Schema.String),
  /** The incident a note was written on, which the line names and opens. */
  incident: optional(Schema.Struct({ id: Schema.String, title: Schema.String })),
  /** The agent an item is about, where `service` names an agent, so it opens the agent's page. */
  agent: optional(Schema.String),
  /** The job no service owns an item is about, so it opens the job's page. */
  job: optional(Schema.String),
  /** The version a deploy applied, so the overview can say a batch of them in one line (spec 0068). */
  version: optional(Schema.String),
  /** What a build was and whether it passed, likewise. */
  build: optional(Schema.Struct({ title: Schema.String, passed: Schema.Boolean })),
})
export type FeedItem = typeof FeedItem.Type

export const FeedEvent = Schema.Struct({ items: Schema.Array(FeedItem) })
export type FeedEvent = typeof FeedEvent.Type
