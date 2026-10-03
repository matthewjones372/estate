/** @jsxImportSource solid-js */
/** A service's lane on the overview: health, pipeline, the last hour, and its links. */
import { For, Show } from "solid-js"
import type { CatalogEvent, DeploysEvent, Health, ServiceState } from "../../shared/events"
import { useEstate } from "../context"
import { clock } from "../format"
import { A, Out } from "./A"
import { Icon } from "./icons"
import { pipelineOf, Rail } from "./Rail"
import { Spark } from "./Sparkline"

const healthWords: Readonly<Record<Health, string>> = {
  healthy: "Healthy",
  attention: "Degraded",
  critical: "Down",
  unknown: "Unknown",
}

type Described = CatalogEvent["services"][number]

const linksOf = (
  service: Pick<Described, "links" | "repository" | "runbook">,
): ReadonlyArray<{ readonly name: string; readonly url: string }> => [
  ...[...service.links].sort((a, b) => rank(a.name) - rank(b.name)),
  ...(service.repository === undefined
    ? []
    : [{ name: "repo", url: `https://github.com/${service.repository.replace(/^github:/, "")}` }]),
  ...(service.runbook === undefined ? [] : [{ name: "runbook", url: service.runbook }]),
]

const labels: Readonly<Record<string, string>> = {
  app: "Open",
  frontend: "Open",
  site: "Open",
  api: "API",
  swagger: "API",
  openapi: "API",
  oncall: "On call",
}
const order = ["app", "frontend", "site", "logs", "traces", "dashboard", "api", "swagger", "openapi"]
const rank = (name: string) => (order.includes(name) ? order.indexOf(name) : order.length)

export const label = (name: string) => labels[name] ?? name.charAt(0).toUpperCase() + name.slice(1)

export const Links = (props: { readonly service: Pick<Described, "name" | "links" | "repository" | "runbook"> }) => (
  <nav aria-label={`${props.service.name} links`} class="links">
    <For each={linksOf(props.service)}>
      {(link) => (
        <Out href={link.url} class="link-chip">
          <Icon name={link.name} />
          {label(link.name)}
        </Out>
      )}
    </For>
  </nav>
)

/** A service's or a store's health, its first reason, and for a service its pods. */
export const HealthLine = (props: {
  readonly state: (Pick<ServiceState, "health" | "reasons"> & Partial<Pick<ServiceState, "pods">>) | undefined
}) => {
  const health = () => props.state?.health ?? "unknown"
  const why = () => {
    const pods = props.state?.pods ?? []
    const ready = pods.filter((pod) => pod.ready).length
    const reasons = props.state?.reasons ?? []
    const first = reasons[0]
    return [
      ...(first === undefined ? [] : [reasons.length > 1 ? `${first} +${reasons.length - 1}` : first]),
      ...(pods.length > 0 ? [`${ready}/${pods.length} pods`] : []),
    ].join(" · ")
  }
  return (
    <span class="health">
      <span class={`dot ${health()}`} />
      <span class={`health-word ${health()}`}>{healthWords[health()]}</span>
      <span class="muted health-why" title={(props.state?.reasons ?? []).join("\n")}>
        {why()}
      </span>
    </span>
  )
}

export const Lane = (props: {
  readonly service: Described
  readonly state: ServiceState | undefined
  readonly deployed: DeploysEvent["services"][number] | undefined
  readonly environment: string
}) => {
  const { now } = useEstate()
  const pipeline = () => {
    return pipelineOf(
      props.deployed?.builds ?? [],
      props.deployed?.environments.find((each) => each.environment === props.environment),
      now(),
    )
  }
  const reasons = () => props.state?.reasons.join(" ") ?? ""
  return (
    <article class={`lane ${props.state?.health ?? "unknown"}`}>
      <div class="lane-name">
        <A to={`/services/${encodeURIComponent(props.service.name)}`} class="lane-title">
          {props.service.name}
        </A>
        <HealthLine state={props.state} />
        <Show when={props.state?.debug?.on === true ? props.state.debug : undefined}>
          {(debug) => (
            <span class="badge-debug">
              <span class="dot live" style={{ background: "var(--debug)", width: "6px", height: "6px" }} />
              Debug{debug().until === undefined ? "" : ` until ${clock(debug().until ?? "")}`}
              {debug().by === undefined ? "" : ` · ${debug().by}`}
            </span>
          )}
        </Show>
      </div>
      <Rail pipeline={pipeline()} version={props.state?.version} />
      <div class="sparks">
        <Spark label="Requests" unit="/s" series={props.state?.load.requests} />
        <Spark
          label="Errors"
          unit="/s"
          series={props.state?.load.errors}
          alarm={(props.state?.load.errors?.now ?? 0) > 0 && /error/i.test(reasons())}
        />
        <Spark label="p99" unit="s" series={props.state?.load.p99} alarm={/latency|slow|p99/i.test(reasons())} />
      </div>
      <Links service={props.service} />
    </article>
  )
}
