/** What `POST /api/alerts/:id/ask` answers: the model's reading of an alert, in a shape the page and a note keep. */
import { Schema } from "effect"

const Confidence = Schema.Literals(["low", "medium", "high"])

/** The answer as the model is told to write it: a likely cause, the evidence for it, and what to do next. */
export const ModelAnswer = Schema.Struct({
  likelyCause: Schema.String,
  evidence: Schema.Array(Schema.Struct({ text: Schema.String, href: Schema.optionalKey(Schema.String) })),
  nextSteps: Schema.Array(Schema.String),
  confidence: Confidence,
})
export type ModelAnswer = typeof ModelAnswer.Type

/** The answer as the page shows it: the model's, with the model's name and what Estate gave it to read. */
export const AskAnswer = Schema.Struct({
  ...ModelAnswer.fields,
  model: Schema.String,
  /** The parts of the brief the model was given: Changed, Depends, Errors, Before, Runbook. */
  read: Schema.Array(Schema.String),
})
export type AskAnswer = typeof AskAnswer.Type
