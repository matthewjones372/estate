/**
 * `estate.yaml`: where Estate listens, its sign-in, its notes database, and each environment's sources. `${NAME}` is
 * read from the environment, so secrets stay out of the file.
 */
import { Context, Data, Effect, Result, Schema } from "effect"
import { checkShape, type Mistake } from "../shared/shape"

const optional = Schema.optionalKey

const Roles = Schema.Struct({
  viewer: Schema.Array(Schema.String),
  operator: Schema.Array(Schema.String),
})

const Oidc = Schema.Struct({
  issuer: Schema.String,
  clientId: Schema.String,
  clientSecret: Schema.String,
  publicUrl: Schema.String,
  groupsClaim: optional(Schema.String),
  nameClaim: optional(Schema.String),
  scopes: optional(Schema.Array(Schema.String)),
})

const Auth = Schema.Struct({
  sessionSecret: Schema.String,
  roles: Roles,
  oidc: optional(Oidc),
  /** Without OIDC, everyone is this person in this role: for trying Estate out, never for an estate people use. */
  anonymous: optional(Schema.Struct({ name: Schema.String, role: Schema.Literals(["viewer", "operator"]) })),
})

const Url = Schema.Struct({ url: Schema.String })

export const Kubernetes = Schema.Struct({
  url: optional(Schema.String),
  token: optional(Schema.String),
  caFile: optional(Schema.String),
  inCluster: optional(Schema.Boolean),
  impersonate: optional(Schema.Boolean),
})

const Sources = Schema.Struct({
  prometheus: optional(Url),
  alertmanager: optional(Url),
  kubernetes: optional(Kubernetes),
  flux: optional(Schema.Struct({})),
})

export type Kubernetes = typeof Kubernetes.Type
export type Sources = typeof Sources.Type

export const Settings = Schema.Struct({
  port: optional(Schema.Number),
  host: optional(Schema.String),
  catalog: Schema.String,
  auth: Auth,
  notes: optional(Schema.Struct({ postgres: Schema.String })),
  sources: Schema.Record(Schema.String, Sources),
  builds: optional(
    Schema.Struct({ github: Schema.Struct({ token: optional(Schema.String), url: optional(Schema.String) }) }),
  ),
})
export type Settings = typeof Settings.Type
export type AuthSettings = typeof Auth.Type

export const SettingsError = Data.TaggedError("SettingsError")<{ readonly mistakes: ReadonlyArray<Mistake> }>
export type SettingsError = InstanceType<typeof SettingsError>

/** Replaces each `${NAME}` with the environment's value, naming each one that is not set. */
export const substitute = (
  text: string,
  environment: Readonly<Record<string, string | undefined>>,
): Result.Result<string, ReadonlyArray<Mistake>> => {
  const missing = new Set<string>()
  const replaced = text.replace(/\$\{(\w+)\}/g, (_, name: string) => {
    const value = environment[name]
    if (value === undefined) missing.add(name)
    return value ?? ""
  })
  return missing.size === 0
    ? Result.succeed(replaced)
    : Result.fail([...missing].map((name) => ({ at: `\${${name}}`, message: "is not set in the environment" })))
}

/** The settings from the text of `estate.yaml`, or every mistake in it. */
export const readSettings = (
  text: string,
  environment: Readonly<Record<string, string | undefined>>,
): Effect.Effect<Settings, SettingsError> =>
  Effect.gen(function* () {
    const substituted = substitute(text, environment)
    if (Result.isFailure(substituted)) return yield* new SettingsError({ mistakes: substituted.failure })
    const parsed = yield* Effect.try({
      try: () => Bun.YAML.parse(substituted.success),
      catch: (error) => new SettingsError({ mistakes: [{ at: "estate.yaml", message: String(error) }] }),
    })
    const shaped = checkShape(Settings, parsed)
    if (Result.isFailure(shaped)) return yield* new SettingsError({ mistakes: shaped.failure })
    const settings = shaped.success
    const sense: Mistake[] = []
    if (settings.auth.oidc === undefined && settings.auth.anonymous === undefined) {
      sense.push({ at: "auth", message: "needs oidc, or anonymous for trying Estate out" })
    }
    if (settings.auth.sessionSecret.length < 32) {
      sense.push({ at: "auth.sessionSecret", message: "needs at least 32 characters" })
    }
    return sense.length === 0 ? settings : yield* new SettingsError({ mistakes: sense })
  })

/** The settings Estate was started with. */
export type Configured = Settings
export const Configured = Context.Service<Configured>("estate/Settings")
