/**
 * Each service's code health (spec 0034), read for the whole estate every few minutes: SonarQube's quality gate and
 * measures for the project a service names, and GitHub's open Dependabot and code scanning alerts for its repository.
 * A tool that fails leaves the others' readings; a repository with no analysis or alerts turned off has none.
 */
import { type Duration, Effect, Option, Redacted, Schema, SubscriptionRef } from "effect"
import type { Service } from "../../shared/catalog"
import { type CodeHealth, none, type Severities } from "../../shared/code"
import { callJson, type Remote, type RemoteError } from "../remote"
import { forEver } from "../schedule"
import type { Code } from "../settings-code"
import { Estate, updateEstate } from "../state"
import { isoNow } from "../time"
import { type Failure, SourceFailure } from "./run"

const base = (url: string) => url.replace(/\/$/, "")
const bearer = (token: Redacted.Redacted | undefined) =>
  token === undefined ? {} : { authorization: `Bearer ${Redacted.value(token)}` }

/** A GET decoded; a 404 or 403, a project or analysis that is not there, as none. */
const ask = <S extends Schema.Decoder<unknown>>(
  tool: string,
  url: string,
  headers: Readonly<Record<string, string>>,
  schema: S,
): Effect.Effect<Option.Option<S["Type"]>, Failure, Remote> =>
  callJson({ url, headers }).pipe(
    Effect.map(Option.some<unknown>),
    Effect.catchIf(
      (error: RemoteError) => error.status === 404 || error.status === 403,
      () => Effect.succeed(Option.none<unknown>()),
    ),
    Effect.mapError((error) => new SourceFailure({ message: `${tool} ${error.message}` })),
    Effect.flatMap((body) =>
      Option.isNone(body)
        ? Effect.succeed(Option.none())
        : Schema.decodeUnknownEffect(schema)(body.value).pipe(
            Effect.map(Option.some),
            Effect.mapError(() => new SourceFailure({ message: `${tool} answered in a shape Estate does not know` })),
          ),
    ),
  )

const Gate = Schema.Struct({ projectStatus: Schema.Struct({ status: Schema.String }) })
const Measures = Schema.Struct({
  component: Schema.Struct({
    measures: Schema.Array(Schema.Struct({ metric: Schema.String, value: Schema.optionalKey(Schema.String) })),
  }),
})

const sonarqube = (tool: NonNullable<Code["sonarqube"]>, project: string) =>
  Effect.gen(function* () {
    const url = base(tool.url)
    const key = encodeURIComponent(project)
    const headers = bearer(tool.token)
    const gate = yield* ask("SonarQube", `${url}/api/qualitygates/project_status?projectKey=${key}`, headers, Gate)
    const measures = yield* ask(
      "SonarQube",
      `${url}/api/measures/component?component=${key}&metricKeys=coverage,bugs,vulnerabilities,code_smells`,
      headers,
      Measures,
    )
    const value = (metric: string) => {
      const found = Option.getOrUndefined(measures)?.component.measures.find((each) => each.metric === metric)?.value
      return found === undefined ? {} : { [metric === "code_smells" ? "smells" : metric]: Number(found) }
    }
    const status = Option.getOrUndefined(gate)?.projectStatus.status
    return {
      gate: status === "OK" ? ("passed" as const) : status === "ERROR" ? ("failed" as const) : ("none" as const),
      ...value("coverage"),
      ...value("bugs"),
      ...value("vulnerabilities"),
      ...value("code_smells"),
      href: `${url}/dashboard?id=${key}`,
    }
  })

const Dependabot = Schema.Array(Schema.Struct({ security_advisory: Schema.Struct({ severity: Schema.String }) }))
const Scanning = Schema.Array(
  Schema.Struct({
    rule: Schema.Struct({
      severity: Schema.optionalKey(Schema.NullOr(Schema.String)),
      security_severity_level: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
  }),
)

/** Severities counted; code scanning's own severity, where it has no security one, as the nearest. */
const counted = (severities: ReadonlyArray<string>): Severities =>
  severities.reduce(
    (sum, severity) => {
      const as =
        severity === "error" ? "high" : severity === "warning" ? "medium" : severity === "note" ? "low" : severity
      return as === "critical" || as === "high" || as === "medium" || as === "low" ? { ...sum, [as]: sum[as] + 1 } : sum
    },
    { ...none },
  )

const github = (tool: NonNullable<Code["github"]>, repository: string) =>
  Effect.gen(function* () {
    const url = `${base(tool.url ?? "https://api.github.com")}/repos/${repository}`
    const headers = { accept: "application/vnd.github+json", ...bearer(tool.token) }
    const page = `https://github.com/${repository}/security`
    const dependabot = yield* ask("GitHub", `${url}/dependabot/alerts?state=open&per_page=100`, headers, Dependabot)
    const scanning = yield* ask("GitHub", `${url}/code-scanning/alerts?state=open&per_page=100`, headers, Scanning)
    return {
      ...Option.match(dependabot, {
        onNone: () => ({}),
        onSome: (alerts) => ({
          dependabot: {
            alerts: counted(alerts.map((alert) => alert.security_advisory.severity)),
            href: `${page}/dependabot`,
          },
        }),
      }),
      ...Option.match(scanning, {
        onNone: () => ({}),
        onSome: (alerts) => ({
          scanning: {
            alerts: counted(alerts.map((alert) => alert.rule.security_severity_level ?? alert.rule.severity ?? "")),
            href: `${page}/code-scanning`,
          },
        }),
      }),
    }
  })

/** A service's code health from the tools it names; a tool that fails says why, and the rest stand. */
const codeOf = (tools: Code, service: Service) =>
  Effect.gen(function* () {
    const repository = /^github:(.+)$/.exec(service.repository ?? "")?.[1]
    const project = service.code?.sonarqube?.project
    const failures: Array<string> = []
    const kept = <A>(read: Effect.Effect<A, Failure, Remote>) =>
      Effect.result(read).pipe(
        Effect.map((result) => {
          if (result._tag === "Success") return result.success
          failures.push(result.failure.message)
          return undefined
        }),
      )
    const sonar =
      tools.sonarqube === undefined || project === undefined
        ? undefined
        : yield* kept(sonarqube(tools.sonarqube, project))
    const alerts =
      tools.github === undefined || repository === undefined ? undefined : yield* kept(github(tools.github, repository))
    const health: CodeHealth = { ...(sonar === undefined ? {} : { sonarqube: sonar }), ...alerts }
    return { health, failures }
  })

/** Every service's code health, by its name, read once; and what failed. */
export const readCode = (tools: Code, services: ReadonlyArray<Service>) =>
  Effect.map(
    Effect.forEach(services, (service) => Effect.map(codeOf(tools, service), (read) => [service.name, read] as const), {
      concurrency: 4,
    }),
    (read) => ({
      health: Object.fromEntries(
        read.flatMap(([name, { health }]) => (Object.keys(health).length === 0 ? [] : [[name, health] as const])),
      ),
      failures: read.flatMap(([name, { failures }]) => failures.map((failure) => `${name}: ${failure}`)),
    }),
  )

/** Every service's code health, read now and every `every` into the estate. */
export const runCode = (tools: Code, every: Duration.Input): Effect.Effect<never, never, Estate | Remote> =>
  forEver(
    Effect.gen(function* () {
      const { catalog } = yield* SubscriptionRef.get(yield* Estate)
      const { health, failures } = yield* readCode(tools, catalog.services)
      const at = yield* isoNow
      if (failures.length > 0) yield* Effect.logWarning(`code health could not all be read: ${failures.join("; ")}`)
      yield* updateEstate((estate) => ({
        ...estate,
        code: {
          state: failures.length > 0 && Object.keys(health).length === 0 ? ("failing" as const) : ("ok" as const),
          answeredAt: at,
          value: health,
          ...(failures.length === 0 ? {} : { message: failures[0] ?? "" }),
        },
      }))
    }),
    every,
  )
