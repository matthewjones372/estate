/**
 * *What changed* around an incident (spec 0047): each of its services' versions at its start, what was deployed or
 * rolled back during it, and at its close, read from its version events, with a link to compare start and close.
 */
import { Schema } from "effect"
import type { FiringEvent } from "./timeline"

const optional = Schema.optionalKey

export const ServiceVersions = Schema.Struct({
  service: Schema.String,
  /** Where its versions were seen; none when no version is known for it. */
  environment: optional(Schema.String),
  /** At the window's start; none when a deploy in the window hides it. */
  start: optional(Schema.String),
  changes: Schema.Array(
    Schema.Struct({ at: Schema.String, from: optional(Schema.String), to: Schema.String, rolledBack: Schema.Boolean }),
  ),
  /** At its close, or the latest while it is open. */
  close: optional(Schema.String),
  compare: optional(Schema.String),
})
export type ServiceVersions = typeof ServiceVersions.Type

/** What of a catalog service links its versions: its repository, or a `compare` link with `{from}` and `{to}`. */
interface Linked {
  readonly name: string
  readonly repository?: string
  readonly links?: Readonly<Record<string, string>>
}

/** A link from one version to another: GitHub's or GitLab's for a repository, else the service's own template. */
const compareLink = (service: Linked | undefined, from: string, to: string): string | undefined => {
  const [, host, path] = /^(github|gitlab):(.+)$/.exec(service?.repository ?? "") ?? []
  if (host === "github") return `https://github.com/${path}/compare/${from}...${to}`
  if (host === "gitlab") return `https://gitlab.com/${path}/-/compare/${from}...${to}`
  return service?.links?.["compare"]?.replace("{from}", from).replace("{to}", to)
}

// The versions are read back from the words Estate wrote for them, so these follow `seen.ts` and `rebuilt.ts`.
const running = /^\S+ (\S+) running in (\S+)$/
const hidden = /^the version of \S+ before \S+ is not known here$/
const moved = /^\S+ (\S+) → (\S+) in (\S+?)(, rolled back)?$/
const deployed = /^\S+ (\S+) deployed in (\S+)$/

type Fact =
  | { readonly kind: "running"; readonly version: string; readonly environment: string }
  | { readonly kind: "hidden" }
  | { readonly kind: "change"; readonly change: ServiceVersions["changes"][number]; readonly environment: string }

const factOf = (event: FiringEvent): ReadonlyArray<Fact> => {
  if (event.kind === "version-seen") {
    const [, version, environment] = running.exec(event.text) ?? []
    if (version !== undefined && environment !== undefined) return [{ kind: "running", version, environment }]
    return hidden.test(event.text) ? [{ kind: "hidden" }] : []
  }
  if (event.kind !== "deployed") return []
  const [, from, to, environment, back] = moved.exec(event.text) ?? []
  if (from !== undefined && to !== undefined && environment !== undefined)
    return [{ kind: "change", change: { at: event.at, from, to, rolledBack: back !== undefined }, environment }]
  const [, version, where] = deployed.exec(event.text) ?? []
  return version === undefined || where === undefined
    ? []
    : [{ kind: "change", change: { at: event.at, to: version, rolledBack: false }, environment: where }]
}

const versionIn = (fact: Fact | undefined) =>
  fact?.kind === "running" ? fact.version : fact?.kind === "change" ? fact.change.to : undefined

/** Each of `services` and what changed for it, in the order given, from the incident's events in time order. */
export const versionsOf = (
  events: ReadonlyArray<FiringEvent>,
  services: ReadonlyArray<string>,
  catalog: ReadonlyArray<Linked>,
): ReadonlyArray<ServiceVersions> =>
  services.map((service) => {
    const facts = events.filter((event) => event.service === service).flatMap(factOf)
    // The first is its start, unless a deploy hid it; the last is where it ended, or is now.
    const start = facts[0]?.kind === "running" ? facts[0].version : undefined
    const close = versionIn(facts.at(-1))
    const environment = facts.flatMap((fact) => (fact.kind === "hidden" ? [] : [fact.environment])).at(-1)
    const compare =
      start === undefined || close === undefined || start === close
        ? undefined
        : compareLink(
            catalog.find((each) => each.name === service),
            start,
            close,
          )
    return {
      service,
      ...(environment === undefined ? {} : { environment }),
      ...(start === undefined ? {} : { start }),
      changes: facts.flatMap((fact) => (fact.kind === "change" ? [fact.change] : [])),
      ...(close === undefined ? {} : { close }),
      ...(compare === undefined ? {} : { compare }),
    }
  })
