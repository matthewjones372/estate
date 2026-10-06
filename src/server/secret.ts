/** A secret in the settings: read as text, kept `Redacted` so it cannot reach a log line or an error. */
import { Schema } from "effect"

/** Unwrapped only where it is sent. */
export const Secret = Schema.RedactedFromValue(Schema.String)
