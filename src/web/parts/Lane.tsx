/** A service's lane on the overview: health, pipeline, the last hour, and its links. */
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

const linksOf = (service: Described): ReadonlyArray<{ readonly name: string; readonly url: string }> => [
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
}
const order = ["app", "frontend", "site", "logs", "traces", "dashboard", "api", "swagger", "openapi"]
const rank = (name: string) => (order.includes(name) ? order.indexOf(name) : order.length)

const label = (name: string) => labels[name] ?? name.charAt(0).toUpperCase() + name.slice(1)

export const Links = (props: { readonly service: Described }) => (
  <nav aria-label={`${props.service.name} links`} className="links">
    {linksOf(props.service).map((link) => (
      <Out key={link.name} href={link.url} className="link-chip">
        <Icon name={link.name} />
        {label(link.name)}
      </Out>
    ))}
  </nav>
)

export const HealthLine = (props: { readonly state: ServiceState | undefined }) => {
  const health = props.state?.health ?? "unknown"
  const pods = props.state?.pods ?? []
  const ready = pods.filter((pod) => pod.ready).length
  const why = [...(props.state?.reasons ?? []), ...(pods.length > 0 ? [`${ready}/${pods.length} pods`] : [])].join(
    " · ",
  )
  return (
    <span className="health">
      <span className={`dot ${health}`} />
      <span className={`health-word ${health}`}>{healthWords[health]}</span>
      <span className="muted">{why}</span>
    </span>
  )
}

export const Lane = (props: {
  readonly service: Described
  readonly state: ServiceState | undefined
  readonly deploys: DeploysEvent | undefined
  readonly environment: string
}) => {
  const { now } = useEstate()
  const { service, state } = props
  const deployed = props.deploys?.services.find((each) => each.name === service.name)
  const pipeline = pipelineOf(
    deployed?.builds ?? [],
    deployed?.environments.find((each) => each.environment === props.environment),
    now(),
  )
  const reasons = state?.reasons.join(" ") ?? ""
  return (
    <article className={`lane ${state?.health ?? "unknown"}`}>
      <div className="lane-name">
        <A to={`/services/${encodeURIComponent(service.name)}`} className="lane-title">
          {service.name}
        </A>
        <HealthLine state={state} />
        {state?.debug?.on === true && (
          <span className="badge-debug">
            <span className="dot live" style={{ background: "var(--debug)", width: 6, height: 6 }} />
            Debug{state.debug.until === undefined ? "" : ` until ${clock(state.debug.until)}`}
            {state.debug.by === undefined ? "" : ` · ${state.debug.by}`}
          </span>
        )}
      </div>
      <Rail pipeline={pipeline} version={state?.version} />
      <div className="sparks">
        <Spark label="Requests" unit="/s" series={state?.load.requests} />
        <Spark
          label="Errors"
          unit="/s"
          series={state?.load.errors}
          alarm={(state?.load.errors?.now ?? 0) > 0 && /error/i.test(reasons)}
        />
        <Spark label="p99" unit="s" series={state?.load.p99} alarm={/latency|slow|p99/i.test(reasons)} />
      </div>
      <Links service={service} />
    </article>
  )
}
