/** @jsxImportSource solid-js */
/**
 * An incident's firings, each linking to its alert's live page while it fires or to its past firing's page once it
 * has resolved, in its own environment; operators unlink one while the incident is open.
 */
import { createSignal, For, type JSX, Show } from "solid-js"
import type { Incident, IncidentRecord } from "../../shared/incidents"
import { useEstate, useSnapshot } from "../context"
import { stamp } from "../format"
import { firingPath, pathOf } from "../route"
import { canKeepIncidents } from "./IncidentLink"

type Firing = Incident["firings"][number]

/** A link to a page in another environment: choosing that environment first, as the address says. */
const Across = (props: { readonly environment: string; readonly to: string; readonly children: JSX.Element }) => {
  const { actions } = useEstate()
  const snapshot = useSnapshot()
  const elsewhere = () => props.environment !== snapshot.environment
  const follow = (event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
    event.preventDefault()
    if (elsewhere()) actions.choose(props.environment)
    actions.navigate(props.to)
  }
  return (
    <a
      href={elsewhere() ? `${props.to}?env=${encodeURIComponent(props.environment)}` : props.to}
      onClick={follow}
      class="mono"
    >
      {props.children}
    </a>
  )
}

const sameTime = (one: string, other: string) => Date.parse(one) === Date.parse(other)

export const IncidentFirings = (props: {
  readonly record: IncidentRecord
  /** Reads the incident again once a firing is unlinked. */
  readonly changed: () => void
}) => {
  const { actions, me, now } = useEstate()
  const snapshot = useSnapshot()
  const [busy, setBusy] = createSignal<Firing | undefined>(undefined)
  const [refused, setRefused] = createSignal<string | undefined>(undefined)
  // Resolved where Estate saw it end, or where this environment's alerts are read and it is not among them.
  const resolved = (firing: Firing) =>
    props.record.events.some(
      (event) =>
        event.kind === "resolved" &&
        event.environment === firing.environment &&
        event.alert === firing.alert &&
        Date.parse(event.at) >= Date.parse(firing.startsAt),
    ) ||
    (snapshot.environment === firing.environment &&
      snapshot.events.alerts !== undefined &&
      !snapshot.events.alerts.alerts.some(
        (each) => each.id === firing.alert && sameTime(each.startsAt, firing.startsAt),
      ))
  const pageOf = (firing: Firing) =>
    resolved(firing) ? firingPath(firing.alert, firing.startsAt) : pathOf({ page: "alert", id: firing.alert })
  const canUnlink = () => canKeepIncidents(me) && props.record.incident.closedAt === undefined
  const unlink = (firing: Firing) => {
    if (busy() !== undefined) return
    setBusy(firing)
    setRefused(undefined)
    void actions.unlinkIncident(props.record.incident.id, firing.environment, firing.alert).then((result) => {
      setBusy(undefined)
      if (typeof result === "string") setRefused(result)
      else props.changed()
    })
  }
  return (
    <section aria-labelledby="incident-firings" class="panel section-box stack incident-firings">
      <h2 id="incident-firings" class="section-title">
        Firings
      </h2>
      <Show
        when={props.record.incident.firings.length > 0}
        fallback={<p class="muted">No firing is part of it now.</p>}
      >
        <ul class="stack" style={{ margin: 0, padding: 0, "list-style": "none", gap: "6px" }}>
          <For each={props.record.incident.firings}>
            {(firing) => (
              <li>
                <Across environment={firing.environment} to={pageOf(firing)}>
                  {firing.name ?? firing.alert}
                </Across>{" "}
                · {firing.environment} ·{" "}
                {resolved(firing)
                  ? `resolved, fired ${stamp(firing.startsAt, now())}`
                  : `firing since ${stamp(firing.startsAt, now())}`}
                <Show when={canUnlink()}>
                  {" "}
                  <button
                    type="button"
                    class="amber-button ghost"
                    disabled={busy() !== undefined}
                    aria-busy={busy() === firing}
                    onClick={() => unlink(firing)}
                  >
                    {busy() === firing ? "Unlinking…" : "Unlink"}
                  </button>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={refused()}>
        {(why) => (
          <p class="alert-detail" role="alert">
            {why()}
          </p>
        )}
      </Show>
    </section>
  )
}
