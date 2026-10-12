/** A note a person wrote: on an alert's firing, or on an incident and shown on each of its firings' cards. */
import { Schema } from "effect"

/** The longest note Estate keeps, in characters. */
export const longestNote = 2000

export const Note = Schema.Struct({ id: Schema.String, at: Schema.String, by: Schema.String, text: Schema.String })
export type Note = typeof Note.Type

/** A note on an alert's card: its own, or one written on the incident its firing is part of, which it names. */
export const CardNote = Schema.Struct({
  ...Note.fields,
  incident: Schema.optionalKey(Schema.Struct({ id: Schema.String, title: Schema.String })),
})
