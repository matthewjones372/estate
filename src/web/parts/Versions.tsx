/** @jsxImportSource solid-js */
/** A service's running version in every environment it is in, so drift is plain without leaving the page. */
import { For, Show } from "solid-js"
import type { DeploysEvent, Health } from "../../shared/events"
import { useEstate, useSnapshot } from "../context"
import { healthWords } from "../format"

type Deployed = DeploysEvent["services"][number]["environments"][number]

type Tone = "healthy" | "attention" | "critical" | "unknown"

const toneOf = (deployed: Deployed): Tone =>
  deployed.stalled !== undefined
    ? "attention"
    : deployed.running === undefined || !deployed.seen
      ? "unknown"
      : "healthy"

const worse: Readonly<Record<Tone, number>> = { critical: 3, attention: 2, unknown: 1, healthy: 0 }

/** Where the service is being looked at, its health counts too: a version that runs is not well if the service is not. */
const toneHere = (deployed: Deployed, health: Health | undefined): Tone => {
  const tone = toneOf(deployed)
  return health === "attention" || health === "critical" ? (worse[health] > worse[tone] ? health : tone) : tone
}

const versionOf = (deployed: Deployed): string => {
  if (!deployed.seen) return "not read"
  return deployed.running ?? "not running"
}

const noteOf = (deployed: Deployed): string | undefined => {
  if (deployed.stalled !== undefined) return deployed.stalled
  if (
    deployed.chosen !== undefined &&
    deployed.running !== undefined &&
    !deployed.chosen.version.includes(deployed.running)
  ) {
    return `moving to ${deployed.chosen.version}`
  }
  return undefined
}

export const Versions = (props: { readonly name: string }) => {
  const { actions } = useEstate()
  const snapshot = useSnapshot()
  const health = () => snapshot.events.services?.services.find((each) => each.name === props.name)?.health
  const environments = () =>
    snapshot.events.deploys?.services.find((each) => each.name === props.name)?.environments ?? []
  return (
    <Show when={environments().length > 0}>
      <fieldset class="bare versions-strip">
        <legend class="muted versions-label">Across environments</legend>
        <div class="versions">
          <For each={environments()}>
            {(each) => {
              const here = () => each.environment === snapshot.environment
              const note = () => noteOf(each)
              const tone = () => (here() ? toneHere(each, health()) : toneOf(each))
              const ill = () =>
                here() && tone() !== toneOf(each) ? healthWords[tone() as Health].toLowerCase() : undefined
              return (
                <button
                  type="button"
                  class={`version-cell${here() ? " current" : ""}`}
                  aria-current={here() ? "true" : undefined}
                  aria-label={`${each.environment}: ${versionOf(each)}${ill() === undefined ? "" : `, ${ill()}`}${note() === undefined ? "" : `, ${note()}`}`}
                  onClick={() => {
                    if (!here()) actions.choose(each.environment)
                  }}
                >
                  <span class="muted version-env">{each.environment}</span>{" "}
                  <span class="cell-version mono">
                    <span class={`dot ${tone()}`} />
                    {versionOf(each)}
                  </span>{" "}
                  <Show when={note()}>{(shown) => <span class="cell-note attention">{shown()}</span>}</Show>
                </button>
              )
            }}
          </For>
        </div>
      </fieldset>
    </Show>
  )
}
