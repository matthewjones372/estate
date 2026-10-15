/** A cluster's API server, as an environment's sources reach it: by URL and token, or from inside the cluster. */
import { Schema } from "effect"
import { Secret } from "./secret"

const optional = Schema.optionalKey

export const Kubernetes = Schema.Struct({
  url: optional(Schema.String),
  token: optional(Secret),
  caFile: optional(Schema.String),
  inCluster: optional(Schema.Boolean),
  impersonate: optional(Schema.Boolean),
  /** Put before the person's name and each group when impersonating, as the cluster's own sign-in names them. */
  impersonationPrefix: optional(Schema.String),
})

export type Kubernetes = typeof Kubernetes.Type
