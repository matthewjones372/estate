/**
 * `estate.yaml`: where Estate listens, its sign-in, its notes database, and each environment's sources. `${NAME}` is
 * read from the environment, so secrets stay out of the file.
 */
import { Config, Context, Data, Effect, Option, Redacted, Result, Schema } from "effect"
import { checkShape, type Mistake } from "../shared/shape"
import { Secret } from "./secret"
import { Ai, Mcp } from "./settings-ai"
import { Backstage } from "./settings-backstage"
import { ClusterSettings, clusterMistakes } from "./settings-cluster"
import { Code } from "./settings-code"
import { Costs, Prices } from "./settings-costs"
import { Database, databaseMistakes, misplacedDatabase } from "./settings-database"

const optional = Schema.optionalKey

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

/** Harness's NextGen API: the account, an API key, and its URL unless it is app.harness.io. */
const Harness = Schema.Struct({ url: optional(Schema.String), account: Schema.String, apiKey: Secret })

/** How often a part is read, as `30s`, `2m` or `1h`. */
const Every = Schema.String

const units: Readonly<Record<string, number>> = { s: 1, m: 60, h: 3600 }

/** The seconds in `30s`, `2m` or `1h`, or nothing if it is not written so. */
export const secondsIn = (text: string): number | undefined => {
  const match = /^(\d+)(s|m|h)$/.exec(text)
  return match === null ? undefined : Number(match[1]) * (units[match[2] ?? ""] ?? 0)
}

const shortest = 5

/** Each interval that is not a duration, or is shorter than Estate will read anything. */
const everyMistakes = (settings: Settings): ReadonlyArray<Mistake> => {
  const set = [
    ...Object.entries(settings.sources).flatMap(([name, section]) =>
      Object.entries(section.every ?? {}).map(([part, text]) => [`sources.${name}.every.${part}`, text] as const),
    ),
    ...(settings.builds?.every === undefined ? [] : [["builds.every", settings.builds.every] as const]),
    ...(settings.kiosk?.every === undefined ? [] : [["kiosk.every", settings.kiosk.every] as const]),
    ...(settings.code?.every === undefined ? [] : [["code.every", settings.code.every] as const]),
  ]
  return set.flatMap(([at, text]) => {
    const seconds = secondsIn(text ?? "")
    if (seconds === undefined) return [{ at, message: `"${text}" is not a duration: write 30s, 2m or 1h` }]
    return seconds < shortest ? [{ at, message: `"${text}" is under ${shortest}s, the most often Estate reads` }] : []
  })
}

/** A model with nowhere to be asked, and agents' tokens short enough to guess. */
const askMistakes = (settings: Settings): ReadonlyArray<Mistake> => [
  ...(settings.ai?.provider === "openai-compatible" && settings.ai.url === undefined
    ? [{ at: "ai.url", message: "names the server an openai-compatible model is asked on" }]
    : []),
  ...(settings.mcp?.tokens ?? []).flatMap((each, index) =>
    Redacted.value(each.token).length < 32
      ? [{ at: `mcp.tokens.${index}.token`, message: `${each.name}'s token needs at least 32 characters` }]
      : [],
  ),
]

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
  /**
   * Grafana's alerting, in place of Alertmanager: its URL and a service account's token. Naming a Prometheus or Loki
   * data source's uid reaches it through Grafana, in place of `prometheus` or `loki`.
   */
  grafana: optional(
    Schema.Struct({
      url: Schema.String,
      token: optional(Secret),
      prometheus: optional(Schema.String),
      loki: optional(Schema.String),
    }),
  ),
  kubernetes: optional(Kubernetes),
  flux: optional(Schema.Struct({})),
  /** AWS, for services on ECS: the region, through the credentials AWS's tools would find. */
  aws: optional(Schema.Struct({ region: Schema.String, endpoint: optional(Schema.String) })),
  /** Harness CD, in place of Flux or Argo CD: the account and an API key. */
  harness: optional(Harness),
  /** Argo CD, in place of Flux: its URL and a token that may read its Applications. */
  argo: optional(Schema.Struct({ url: Schema.String, token: optional(Secret) })),
  /** Datadog, for monitors, downtimes, load and lines: its site, its keys, and the tags that are this environment. */
  datadog: optional(
    Schema.Struct({
      site: optional(Schema.String),
      url: optional(Schema.String),
      apiKey: Secret,
      appKey: Secret,
      tags: optional(Schema.Array(Schema.String)),
    }),
  ),
  /** Langfuse, where the agents' runs are traced: its URL (Langfuse's cloud unless set) and a project's keys. */
  langfuse: optional(Schema.Struct({ url: optional(Schema.String), publicKey: Secret, secretKey: Secret })),
  /** What this environment costs: its bill by tag, Kubernetes' share, and the AI providers' reports. */
  costs: optional(Costs),
  /** How often each part is read, where its usual interval is too often for the tool or its bill. */
  every: optional(
    Schema.Struct({
      alerts: optional(Every),
      metrics: optional(Every),
      cluster: optional(Every),
      deploys: optional(Every),
      costs: optional(Every),
    }),
  ),
})

export type Kubernetes = typeof Kubernetes.Type
export type Sources = typeof Sources.Type

export const Settings = Schema.Struct({
  port: optional(Schema.Number),
  host: optional(Schema.String),
  /** Write to no tool: no silences, no debug switched, notes kept in memory. For trying Estate on a team's tools. */
  readOnly: optional(Schema.Boolean),
  catalog: Schema.String,
  /** The catalog's environments this Estate shows, where it cannot reach them all: every one unless set. */
  environments: optional(Schema.Array(Schema.String)),
  auth: Auth,
  /** How many days each alert's firings are kept, with who silenced them and why: 90 unless set. */
  alerts: optional(Schema.Struct({ historyDays: optional(Schema.Number) })),
  /** Estate's own database, for its notes, impacts, alert history and threads: Postgres, DynamoDB, or else memory. */
  database: optional(Database),
  /** How many days notes are kept: 30 unless set. */
  notes: optional(Schema.Struct({ keepDays: optional(Schema.Number) })),
  sources: Schema.Record(Schema.String, Sources),
  /** A screen on the wall: the token it signs in with once, the environments it shows in turn, and how long each. */
  kiosk: optional(
    Schema.Struct({ token: Secret, environments: optional(Schema.Array(Schema.String)), every: optional(Every) }),
  ),
  /** Estate's own metrics, for Prometheus to scrape, on a port of their own without sign-in (9464 unless set). */
  metrics: optional(Schema.Struct({ port: optional(Schema.Number) })),
  /** Estate's own traces and logs, sent over OTLP to a collector when one is named. */
  telemetry: optional(Schema.Struct({ otlp: optional(Schema.String) })),
  /** Credentials for reading runbooks' text, by the host their links name: a token, with a user for Basic. */
  runbooks: optional(
    Schema.Array(Schema.Struct({ host: Schema.String, user: optional(Schema.String), token: optional(Secret) })),
  ),
  /** Where builds are read, for the whole estate: GitHub Actions, GitLab CI, or both. */
  builds: optional(
    Schema.Struct({
      github: optional(Schema.Struct({ token: optional(Secret), url: optional(Schema.String) })),
      gitlab: optional(Schema.Struct({ token: optional(Secret), url: optional(Schema.String) })),
      /** Jenkins, for services whose catalog entry names a job: its URL, and a user and their API token. */
      jenkins: optional(Schema.Struct({ url: Schema.String, user: optional(Schema.String), token: optional(Secret) })),
      /** Harness CI, for services whose catalog entry names a pipeline: the account and an API key. */
      harness: optional(Harness),
      /** TeamCity, for services whose catalog entry names a build type: its URL and an access token. */
      teamcity: optional(Schema.Struct({ url: Schema.String, token: optional(Secret) })),
      every: optional(Every),
    }),
  ),
  /** Ask AI on an alert: Anthropic, OpenAI, xAI, Gemini, or an OpenAI-compatible server. Without it, Ask AI is hidden. */
  ai: optional(Ai),
  /** Agents that may ask Estate over `/mcp`: each token and the role it reads as. Without it, `/mcp` answers 401. */
  mcp: optional(Mcp),
  /** A Slack bot with `chat:write`, invited to the teams' channels, so an alert's card can tell its team. */
  slack: optional(Schema.Struct({ token: Secret, url: optional(Schema.String) })),
  /** What models' tokens cost, per million, for the estimate of an agent's spend between the providers' reports. */
  prices: optional(Prices),
  /** Code health: SonarQube's gates and GitHub's security alerts, for services that name a project or repository. */
  code: optional(Code),
  /** Backstage, for a catalog's rules that discover services from it. */
  backstage: optional(Backstage),
  /** Several replicas reading each source once: `true`, or the runners' port and health check to override. */
  cluster: optional(ClusterSettings),
})
export type Settings = typeof Settings.Type
export type { Ai, Mcp } from "./settings-ai"
export type { Prices } from "./settings-costs"
export type AuthSettings = typeof Auth.Type

export const SettingsError = Data.TaggedError("SettingsError")<{ readonly mistakes: ReadonlyArray<Mistake> }>
export type SettingsError = InstanceType<typeof SettingsError>

const named = /\$\{(\w+)\}/g

/** Where a line's YAML comment starts: a `#` at its start or after a space, outside quotes. */
const commentAt = (line: string): number => {
  let quote: string | undefined
  for (let at = 0; at < line.length; at++) {
    const char = line[at]
    if (quote !== undefined) quote = char === quote ? undefined : quote
    else if (char === '"' || char === "'") quote = char
    else if (char === "#" && (at === 0 || /\s/.test(line[at - 1] ?? ""))) return at
  }
  return line.length
}

/** Each line as the YAML it holds and the comment after it, which is left as it is. */
const linesOf = (text: string) =>
  text.split("\n").map((line) => ({ yaml: line.slice(0, commentAt(line)), comment: line.slice(commentAt(line)) }))

/**
 * Replaces each `${NAME}` with its value from the `ConfigProvider` (the environment, unless a test says otherwise),
 * naming each one that is not set. A `${NAME}` in a comment is neither needed nor replaced.
 */
export const substitute = (text: string): Effect.Effect<Result.Result<string, ReadonlyArray<Mistake>>> =>
  Effect.gen(function* () {
    const lines = linesOf(text)
    const names = [...new Set(lines.flatMap((line) => [...line.yaml.matchAll(named)].map((match) => match[1] ?? "")))]
    const values = new Map<string, string>()
    const missing: Mistake[] = []
    for (const name of names) {
      const value = yield* Config.option(Config.String(name)).pipe(Effect.orElseSucceed(() => Option.none()))
      if (Option.isSome(value)) values.set(name, value.value)
      else missing.push({ at: `\${${name}}`, message: "is not set in the environment" })
    }
    const replaced = (yaml: string) => yaml.replace(named, (_, name: string) => values.get(name) ?? "")
    return missing.length === 0
      ? Result.succeed(lines.map((line) => replaced(line.yaml) + line.comment).join("\n"))
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
    const misplaced = misplacedDatabase(parsed)
    if (misplaced.length > 0) return yield* new SettingsError({ mistakes: misplaced })
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
    sense.push(
      ...everyMistakes(settings),
      ...askMistakes(settings),
      ...databaseMistakes(settings.database),
      ...clusterMistakes(settings),
    )
    return sense.length === 0 ? settings : yield* new SettingsError({ mistakes: sense })
  })

/** The settings Estate was started with. */
export type Configured = Settings
export const Configured = Context.Service<Configured>("estate/Settings")
