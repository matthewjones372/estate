/**
 * The incident tool (spec 0043): where an operator raises one of Estate's incidents, and what the tool says of it
 * afterwards. One kind per tool, each tested against a stub of its API, chosen by its key under `incidentTool`
 * (`incidentToolOf`).
 */
import type { Effect } from "effect"
import type { Catalog, Team } from "../../shared/catalog"
import type { Remote } from "../remote"
import type { Failure } from "./run"

export interface Raising {
  /** Estate's incident id, so raising twice raises once. */
  readonly key: string
  readonly title: string
  readonly impact?: string
  readonly firings: ReadonlyArray<{
    readonly environment: string
    readonly name: string
    readonly service?: string
    /** The alert's severity, where a tool's urgency follows it. */
    readonly severity?: string
    readonly startsAt: string
  }>
  /** The incident's page in Estate, where its public URL is known. */
  readonly page?: string
  readonly by: string
  /** Where the owning team's incidents go, by the tool's kind. */
  readonly team?: Team["incidentTool"]
}

export interface Raised {
  readonly id: string
  readonly url: string
}

export interface InTool {
  /** The tool's word: triggered, acknowledged, resolved. */
  readonly status: string
  readonly severity?: string
  readonly responders: ReadonlyArray<string>
  readonly url: string
}

export interface IncidentTool {
  /** As the page and the timeline say it: "PagerDuty". */
  readonly name: string
  readonly raise: (raising: Raising) => Effect.Effect<Raised, Failure, Remote>
  readonly read: (id: string) => Effect.Effect<InTool, Failure, Remote>
  /** For `estate doctor`: what the tool says of the settings, proving them as far as a read can. */
  readonly check: Effect.Effect<string, Failure, Remote>
}

/** Where the team that owns `service` sends its incidents, if it says. */
export const teamToolsOf = (catalog: Catalog, service: string | undefined): Team["incidentTool"] => {
  const owner = catalog.services.find((each) => each.name === service)?.owner
  return catalog.teams?.find((each) => each.name === owner)?.incidentTool
}

/** The incident's details: what it does to people, each firing, the way back to Estate, and who raised it. */
export const detailsOf = (raising: Raising): string =>
  [
    ...(raising.impact === undefined ? [] : [`Impact: ${raising.impact}`, ""]),
    "Firings:",
    ...raising.firings.map(
      (firing) =>
        `- ${firing.name} in ${firing.environment}${firing.service === undefined ? "" : ` (${firing.service})`}, since ${firing.startsAt}`,
    ),
    "",
    ...(raising.page === undefined ? [] : [`In Estate: ${raising.page}`]),
    `Raised from Estate by ${raising.by}`,
  ].join("\n")
