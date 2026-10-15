/** What `POST /api/incidents/:id/summary` answers (spec 0051): an account of an incident, in a shape a note keeps. */
import { Schema } from "effect"
import { AskAnswer } from "./ask"

/** The summary as the model is told to write it. */
export const IncidentSummary = Schema.Struct({
  /** Three to five sentences on what happened, in order. */
  what: Schema.String,
  /** Who was affected and how, or that it is not known from what Estate holds. */
  impact: Schema.String,
  /** The likely cause, citing what it rests on. */
  cause: Schema.String,
  /** The moments that mattered, from the timeline. */
  turns: Schema.Array(Schema.Struct({ at: Schema.String, text: Schema.String })),
  followUps: Schema.Array(Schema.String),
  confidence: AskAnswer.fields.confidence,
})
export type IncidentSummary = typeof IncidentSummary.Type

/** The summary as the page shows it: the model's, with its model, tokens, cost and whether it read logs. */
export const SummaryAnswer = Schema.Struct({
  ...IncidentSummary.fields,
  model: AskAnswer.fields.model,
  usage: AskAnswer.fields.usage,
  cost: AskAnswer.fields.cost,
  readLogs: AskAnswer.fields.readLogs,
})
export type SummaryAnswer = typeof SummaryAnswer.Type
