/** The overview: the headline, the vitals, the map, what needs someone, a lane per service, and what changed. */
import type { Alert, Events } from "../../shared/events"
import { useEstate, useSnapshot } from "../context"
import { clock, counted, measured } from "../format"
import { AlertCard } from "../parts/AlertCard"
import { Feed } from "../parts/Feed"
import { Icon } from "../parts/icons"
import { Lane } from "../parts/Lane"
import { EstateMap } from "../parts/Map"
import { Reading, SourceNotices } from "./States"

export interface Headline {
  readonly tone: "healthy" | "attention" | "critical"
  readonly kicker: string
  readonly top: string
  readonly bottom: string
  readonly lede: string
}

export const headlineOf = (events: Partial<Events>): Headline => {
  const firing = (events.alerts?.alerts ?? []).filter((alert) => alert.state === "firing")
  const services = events.services?.services ?? []
  const troubled = services.filter((service) => service.health === "attention" || service.health === "critical")
  const critical =
    firing.some((alert) => alert.severity === "critical") || services.some((service) => service.health === "critical")
  const count = Math.max(firing.length, troubled.length)
  const reasons = troubled.flatMap((service) =>
    service.reasons.slice(0, 1).map((reason) => `${service.name}: ${reason}`),
  )
  if (count === 0 && services.length > 0 && services.every((service) => service.health === "unknown")) {
    return {
      tone: "healthy",
      kicker: "Listening",
      top: "Not heard yet.",
      bottom: "Reading the sources.",
      lede: "No source has said how the services are, so nothing is claimed about them yet.",
    }
  }
  if (count === 0) {
    const healthy = services.filter((service) => service.health === "healthy").length
    return {
      tone: "healthy",
      kicker: "All healthy",
      top: "All quiet.",
      bottom: "Nothing needs you.",
      lede:
        services.length === 0
          ? "No service is in this environment yet."
          : `${counted(healthy, "service")} healthy, nothing firing.`,
    }
  }
  return {
    tone: critical ? "critical" : "attention",
    kicker: critical ? "Something is down" : "Needs attention",
    top: counted(count, "thing"),
    bottom: count === 1 ? "needs you." : "need you.",
    lede: `${reasons.slice(0, 3).join("; ")}${reasons.length > 3 ? `; and ${reasons.length - 3} more` : ""}.`,
  }
}

interface Tile {
  readonly label: string
  readonly value: string
  readonly note: string
  readonly alarm: boolean
}

/** The catalog's vitals, then what Estate always knows, to fill four tiles. */
export const tilesOf = (events: Partial<Events>): ReadonlyArray<Tile> => {
  const services = events.services?.services ?? []
  const pods = services.flatMap((service) => service.pods)
  const firing = (events.alerts?.alerts ?? []).filter((alert) => alert.state === "firing")
  const stalled = (events.deploys?.services ?? []).flatMap((service) =>
    service.environments.filter(
      (each) => each.stalled !== undefined && each.environment === events.catalog?.environment,
    ),
  )
  const own: ReadonlyArray<Tile> = (events.services?.vitals ?? []).map((vital) => ({
    label: vital.title,
    value: measured(vital.series.now, vital.unit),
    note: "now",
    alarm: false,
  }))
  const always: ReadonlyArray<Tile> = [
    {
      label: "Services healthy",
      value: `${services.filter((service) => service.health === "healthy").length} of ${services.length}`,
      note: "in this environment",
      alarm: false,
    },
    {
      label: "Alerts firing",
      value: String(firing.length),
      note:
        firing.length === 0
          ? "none"
          : firing
              .map((alert) => alert.name)
              .slice(0, 2)
              .join(", "),
      alarm: firing.length > 0,
    },
    {
      label: "Pods ready",
      value: `${pods.filter((pod) => pod.ready).length}/${pods.length}`,
      note: `${pods.reduce((total, pod) => total + pod.restarts, 0)} restarts`,
      alarm: pods.some((pod) => !pod.ready),
    },
    {
      label: "Deploys stalled",
      value: String(stalled.length),
      note: stalled.length === 0 ? "every deploy in step" : "see Deploys",
      alarm: stalled.length > 0,
    },
  ]
  return [...own, ...always].slice(0, Math.max(4, own.length))
}

const Silenced = (props: { readonly alerts: ReadonlyArray<Alert>; readonly canSilence: boolean }) => {
  const { actions } = useEstate()
  return (
    <div className="stack" style={{ gap: 8 }}>
      {props.alerts.map((alert) =>
        alert.silence === undefined ? null : (
          <div key={alert.id} className="silenced-row">
            <Icon name="silence" />
            <span className="mono" style={{ color: "var(--ink-soft)" }}>
              {alert.name}
            </span>
            <span>
              silenced until {clock(alert.silence.endsAt)} by {alert.silence.by}: “{alert.silence.reason}”
            </span>
            {props.canSilence && (
              <button
                type="button"
                className="plain-button push-right"
                onClick={() => void actions.unsilence(alert.silence?.id ?? "")}
              >
                Unsilence
              </button>
            )}
          </div>
        ),
      )}
    </div>
  )
}

export const Overview = () => {
  const { me, now } = useEstate()
  const { events, environment } = useSnapshot()
  const headline = headlineOf(events)
  const alerts = events.alerts?.alerts ?? []
  const firing = alerts.filter((alert) => alert.state === "firing")
  const silenced = alerts.filter((alert) => alert.state === "silenced")
  const canSilence = me.role === "operator" && events.alerts?.silences === true
  const waiting = events.services === undefined || events.services.sources.some((source) => source.state === "waiting")
  return (
    <main className="main">
      {waiting && <Reading sources={events.services?.sources} />}
      <SourceNotices services={events.services} now={now()} />
      <section aria-label="The estate now" className="now">
        <div className="now-words">
          <div className="stack">
            <span className={`kicker ${headline.tone === "healthy" ? "" : headline.tone}`}>
              <span className={`dot ${headline.tone} ${headline.tone === "healthy" ? "" : "hot"}`} />
              {headline.kicker}
            </span>
            <h1 className="headline">
              {headline.top}
              <br />
              {headline.bottom}
            </h1>
            <p className="lede">{headline.lede}</p>
          </div>
          <div className="vitals">
            {tilesOf(events).map((tile) => (
              <div key={tile.label} className="vital">
                <span className="muted" style={{ fontSize: 12 }}>
                  {tile.label}
                </span>
                <span className="vital-value" style={{ color: tile.alarm ? "var(--amber-text)" : undefined }}>
                  {tile.value}
                </span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {tile.note}
                </span>
              </div>
            ))}
          </div>
        </div>
        {events.catalog !== undefined && <EstateMap catalog={events.catalog} services={events.services} />}
      </section>
      <section aria-labelledby="needs" className="stack">
        <h2 id="needs" className="section-title">
          Needs you now
        </h2>
        {firing.length === 0 && (
          <p className="muted" style={{ margin: 0 }}>
            Nothing. When something does, it appears here, above the services.
          </p>
        )}
        <div className="cards">
          {firing.map((alert) => (
            <AlertCard key={alert.id} alert={alert} catalog={events.catalog} canSilence={canSilence} />
          ))}
        </div>
        <Silenced alerts={silenced} canSilence={canSilence} />
      </section>
      <div className="row">
        <section aria-labelledby="services-title" className="services">
          <div className="spread">
            <h2 id="services-title" className="section-title">
              Services
            </h2>
            <span className="muted" style={{ fontSize: 12 }}>
              Last hour · pipeline: commit, build, chosen, running
            </span>
          </div>
          {(events.catalog?.services ?? []).map((service) => (
            <Lane
              key={service.name}
              service={service}
              state={events.services?.services.find((each) => each.name === service.name)}
              deploys={events.deploys}
              environment={environment}
            />
          ))}
        </section>
        <Feed feed={events.feed} />
      </div>
    </main>
  )
}
