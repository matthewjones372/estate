/**
 * `estate.yaml`: where Estate listens, its sign-in, its notes database, and each environment's sources. `${NAME}` is
 * read from the environment, so secrets stay out of the file.
 */
import { Config, Context, Data, Effect, Option, Redacted, Result, Schema } from "effect"
import { checkShape, type Mistake } from "../shared/shape"

const optional = Schema.optionalKey

/** A secret: read as text, kept `Redacted` so it cannot reach a log line or an error, unwrapped only where it is sent. */
const Secret = Schema.RedactedFromValue(Schema.String)

const Roles = Schema.Struct({
  viewer: Schema.Array(Schema.String),
  operator: Schema.Array(Schema.String),
})

const Oidc = Schema.Struct({
  issuer: Schema.String,
  clientId: Schema.String,
  clientSecret: Secret,
  publicUrl: Schema.String,
  groupsClaim: optional(Schema.String),
  nameClaim: optional(Schema.String),
  scopes: optional(Schema.Array(Schema.String)),
})

const Auth = Schema.Struct({
  sessionSecret: Secret,
  roles: Roles,
  oidc: optional(Oidc),
  /** Without OIDC, everyone is this person in this role: for trying Estate out, never for an estate people use. */
  anonymous: optional(Schema.Struct({ name: Schema.String, role: Schema.Literals(["viewer", "operator"]) })),
  /** Who may read services' logs: viewers, or only operators where logs carry customers' data. */
  logs: optional(Schema.Literals(["viewer", "operator"])),
})

const Url = Schema.Struct({ url: Schema.String })

export const Kubernetes = Schema.Struct({
  url: optional(Schema.String),
  token: optional(Secret),
  caFile: optional(Schema.String),
  inCluster: optional(Schema.Boolean),
  impersonate: optional(Schema.Boolean),
  /** Put before the person's name and each group when impersonating, as the cluster's own sign-in names them. */
  impersonationPrefix: optional(Schema.String),
})

const Sources = Schema.Struct({
  prometheus: optional(Url),
  /** Loki, for services' lines; without it, the cluster's own pod logs. */
  loki: optional(Schema.Struct({ url: Schema.String, tenant: optional(Schema.String) })),
  /** Elasticsearch or OpenSearch, for services' lines in place of Loki: an index pattern, and an API key or a user. */
  elasticsearch: optional(
    Schema.Struct({
      url: Schema.String,
      index: optional(Schema.String),
      apiKey: optional(Secret),
      username: optional(Schema.String),
      password: optional(Secret),
    }),
  ),
  alertmanager: optional(Url),
  /** Grafana's alerting, in place of Alertmanager: its URL and a service account's token. */
  grafana: optional(Schema.Struct({ url: Schema.String, token: optional(Secret) })),
  kubernetes: optional(Kubernetes),
  flux: optional(Schema.Struct({})),
  /** Argo CD, in place of Flux: its URL and a token that may read its Applications. */
  argo: optional(Schema.Struct({ url: Schema.String, token: optional(Secret) })),
})

export type Kubernetes = typeof Kubernetes.Type
export type Sources = typeof Sources.Type

export const Settings = Schema.Struct({
  port: optional(Schema.Number),
  host: optional(Schema.String),
  catalog: Schema.String,
  auth: Auth,
  /** Where notes are kept: Postgres, a DynamoDB table, or else memory; and for how many days. */
  notes: optional(
    Schema.Struct({
      postgres: optional(Secret),
      dynamodb: optional(
        Schema.Struct({ table: Schema.String, region: Schema.String, endpoint: optional(Schema.String) }),
      ),
      keepDays: optional(Schema.Number),
    }),
  ),
  sources: Schema.Record(Schema.String, Sources),
  /** Estate's own metrics, for Prometheus to scrape, on a port of their own without sign-in (9464 unless set). */
  metrics: optional(Schema.Struct({ port: optional(Schema.Number) })),
  /** Estate's own traces and logs, sent over OTLP to a collector when one is named. */
  telemetry: optional(Schema.Struct({ otlp: optional(Schema.String) })),
  /** Where builds are read, for the whole estate: GitHub Actions, GitLab CI, or both. */
  builds: optional(
    Schema.Struct({
      github: optional(Schema.Struct({ token: optional(Secret), url: optional(Schema.String) })),
      gitlab: optional(Schema.Struct({ token: optional(Secret), url: optional(Schema.String) })),
    }),
  ),
})
export type Settings = typeof Settings.Type
export type AuthSettings = typeof Auth.Type

export const SettingsError = Data.TaggedError("SettingsError")<{ readonly mistakes: ReadonlyArray<Mistake> }>
export type SettingsError = InstanceType<typeof SettingsError>

const named = /\$\{(\w+)\}/g

/**
 * Replaces each `${NAME}` with its value from the `ConfigProvider` (the environment, unless a test says otherwise),
 * naming each one that is not set.
 */
export const substitute = (text: string): Effect.Effect<Result.Result<string, ReadonlyArray<Mistake>>> =>
  Effect.gen(function* () {
    const names = [...new Set([...text.matchAll(named)].map((match) => match[1] ?? ""))]
    const values = new Map<string, string>()
    const missing: Mistake[] = []
    for (const name of names) {
      const value = yield* Config.option(Config.String(name)).pipe(Effect.orElseSucceed(() => Option.none()))
      if (Option.isSome(value)) values.set(name, value.value)
      else missing.push({ at: `\${${name}}`, message: "is not set in the environment" })
    }
    return missing.length === 0
      ? Result.succeed(text.replace(named, (_, name: string) => values.get(name) ?? ""))
      : Result.fail(missing)
  })

/** The settings from the text of `estate.yaml`, or every mistake in it. */
export const readSettings = (text: string): Effect.Effect<Settings, SettingsError> =>
  Effect.gen(function* () {
    const substituted = yield* substitute(text)
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
    if (Redacted.value(settings.auth.sessionSecret).length < 32) {
      sense.push({ at: "auth.sessionSecret", message: "needs at least 32 characters" })
    }
    return sense.length === 0 ? settings : yield* new SettingsError({ mistakes: sense })
  })

/** The settings Estate was started with. */
export type Configured = Settings
export const Configured = Context.Service<Configured>("estate/Settings")
