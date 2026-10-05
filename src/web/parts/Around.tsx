/** @jsxImportSource solid-js */
/** What changed near an alert: deploys and builds in the hour before it fired. Useful with no AI set up. */
import { For, Show } from "solid-js"
import type { Alert, CatalogEvent, DeploysEvent } from "../../shared/events"
import { useSnapshot } from "../context"
import { since } from "../format"
import { A } from "./A"

const hour = 3_600_000

export interface ChangeNear {
  readonly kind: "deploy" | "build"
  readonly service: string
  readonly text: string
  readonly at: string
}

/** Deploys and builds of `service` (and named neighbours) in the hour before `startsAt`. */
export const changesNear = (
  startsAt: string,
  service: string | undefined,
  deploys: DeploysEvent | undefined,
  environment: string | undefined,
  neighbours: ReadonlyArray<string> = [],
): ReadonlyArray<ChangeNear> => {
  if (service === undefined || deploys === undefined) return []
  const fired = Date.parse(startsAt)
  const windowStart = fired - hour
  const names = new Set([service, ...neighbours])
  const found: ChangeNear[] = []
  for (const each of deploys.services) {
    if (!names.has(each.name)) continue
    const env = each.environments.find((row) => row.environment === environment)
    const at = env?.chosen?.at
    if (at !== undefined) {
      const when = Date.parse(at)
      if (when >= windowStart && when <= fired) {
        const version = env?.chosen?.version ?? env?.running ?? "a version"
        found.push({
          kind: "deploy",
          service: each.name,
          text: `${version} deployed`,
          at,
        })
      }
    }
    for (const build of each.builds) {
      const when = Date.parse(build.at)
      if (when >= windowStart && when <= fired) {
        found.push({
          kind: "build",
          service: each.name,
          text: `build ${build.status}: ${build.title}`,
          at: build.at,
        })
      }
    }
  }
  return found.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}

/** Services next to this one on the catalog map (depends / callers). */
export const neighboursOf = (catalog: CatalogEvent | undefined, service: string | undefined): ReadonlyArray<string> => {
  if (catalog === undefined || service === undefined) return []
  const node = catalog.map.nodes.find((each) => each.service === service)?.id
  if (node === undefined) return []
  const ids = new Set<string>()
  for (const edge of catalog.map.edges) {
    if (edge.from === node) ids.add(edge.to)
    if (edge.to === node) ids.add(edge.from)
  }
  return catalog.map.nodes
    .filter((each) => ids.has(each.id) && each.service !== undefined && each.service !== service)
    .map((each) => each.service as string)
}

const lineOf = (change: ChangeNear, firedAt: string): string => {
  const before = Date.parse(firedAt) - Date.parse(change.at)
  const gap = since(change.at, Date.parse(firedAt))
  const when = before >= 0 ? `${gap} before it fired` : `${since(firedAt, Date.parse(change.at))} after it fired`
  return `${change.service} ${change.text} ${when}`
}

export const Around = (props: { readonly alert: Alert }) => {
  const snapshot = useSnapshot()
  const catalog = () => snapshot.events.catalog
  const deploys = () => snapshot.events.deploys
  const environment = () => catalog()?.environment
  const neighbours = () => neighboursOf(catalog(), props.alert.service)
  const changes = () => changesNear(props.alert.startsAt, props.alert.service, deploys(), environment(), neighbours())
  return (
    <div class="alert-around">
      <span class="alert-label">Around this alert</span>
      <Show
        when={props.alert.service !== undefined}
        fallback={<p class="alert-detail muted">No service is named on this alert, so nothing nearby to correlate.</p>}
      >
        <Show
          when={changes().length > 0}
          fallback={
            <p class="alert-detail">
              No deploys or builds of {props.alert.service}
              {neighbours().length === 0 ? "" : ` (or ${neighbours().join(", ")})`} in the hour before it fired.
            </p>
          }
        >
          <ul class="around-list">
            <For each={changes()}>{(change) => <li>{lineOf(change, props.alert.startsAt)}</li>}</For>
          </ul>
        </Show>
        <Show when={props.alert.service}>
          {(name) => (
            <p class="alert-quiet">
              <A to={`/services/${encodeURIComponent(name())}`}>{name()}</A>
              {" · "}
              look at deploys and builds for what changed
            </p>
          )}
        </Show>
      </Show>
    </div>
  )
}

/** A compact one-liner for cards: the nearest deploy, or that nothing deployed in the hour before. */
export const AroundLine = (props: { readonly alert: Alert }) => {
  const snapshot = useSnapshot()
  const catalog = () => snapshot.events.catalog
  const changes = () =>
    changesNear(
      props.alert.startsAt,
      props.alert.service,
      snapshot.events.deploys,
      catalog()?.environment,
      neighboursOf(catalog(), props.alert.service),
    )
  const nearest = () => changes()[0]
  return (
    <Show when={props.alert.service !== undefined}>
      <p class="alert-detail around-line">
        <Show when={nearest()} fallback={<>No deploys in the hour before it fired.</>}>
          {(change) => (
            <>
              {change().service} {change().text} {since(change().at, Date.parse(props.alert.startsAt))} before it fired.
            </>
          )}
        </Show>
      </p>
    </Show>
  )
}
