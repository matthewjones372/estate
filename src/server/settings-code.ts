/** The settings for code health (spec 0034): SonarQube, GitHub's security alerts, and how often they are read. */
import { Schema } from "effect"
import { Secret } from "./secret"

const optional = Schema.optionalKey

export const Code = Schema.Struct({
  sonarqube: optional(Schema.Struct({ url: Schema.String, token: optional(Secret) })),
  /** Dependabot's and code scanning's alerts, by each service's repository; `url` for GitHub Enterprise's API. */
  github: optional(Schema.Struct({ token: optional(Secret), url: optional(Schema.String) })),
  every: optional(Schema.String),
})
export type Code = typeof Code.Type
