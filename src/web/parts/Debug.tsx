/** A service's debug switch: on for a while under someone's name, then off by itself. */
import { useState } from "react"
import type { CatalogEvent, ServiceState } from "../../shared/events"
import { useEstate } from "../context"
import { clock } from "../format"

const spans = [
  { label: "15 min", minutes: 15 },
  { label: "1 hour", minutes: 60 },
  { label: "2 hours", minutes: 120 },
] as const

export const DebugPanel = (props: {
  readonly service: CatalogEvent["services"][number]
  readonly state: ServiceState | undefined
}) => {
  const { me, actions, now } = useEstate()
  const [minutes, setMinutes] = useState<number>(15)
  const [confirming, setConfirming] = useState(false)
  const levels = props.service.debug?.levels
  const debug = props.state?.debug
  if (levels === undefined) {
    return (
      <p className="muted" style={{ margin: 0 }}>
        The catalog names no log level for {props.service.name}, so it cannot be switched here.
      </p>
    )
  }
  const operator = me.role === "operator"
  const debugLevel = levels.at(-1) ?? "DEBUG"
  return (
    <div className="stack">
      <div className="spread">
        <span className="mono">{debug?.level ?? levels[0]}</span>
      </div>
      {debug?.on === true ? (
        <div className="debug-on stack">
          <strong>On until {debug.until === undefined ? "switched off" : clock(debug.until)}</strong>
          <span className="secondary" style={{ fontSize: 13 }}>
            Turned on{debug.by === undefined ? "" : ` by ${debug.by}`}
            {debug.since === undefined ? "" : ` at ${clock(debug.since)}`}. It turns itself off then; nobody needs to
            remember.
          </span>
          {operator && (
            <button
              type="button"
              className="plain-button"
              style={{ alignSelf: "flex-start" }}
              onClick={() => void actions.undebug(props.service.name)}
            >
              Turn off now
            </button>
          )}
        </div>
      ) : (
        <div className="stack">
          <p className="secondary" style={{ margin: 0, fontSize: 13 }}>
            Off: it logs at {debug?.level ?? levels[0]}.
          </p>
          {operator && (
            <>
              <fieldset className="choices bare">
                <legend className="visually-hidden">For how long</legend>
                {spans.map((span) => (
                  <button
                    key={span.minutes}
                    type="button"
                    aria-pressed={minutes === span.minutes}
                    className="choice debug-choice"
                    onClick={() => setMinutes(span.minutes)}
                  >
                    {span.label}
                  </button>
                ))}
              </fieldset>
              {!confirming && (
                <button type="button" className="debug-button" onClick={() => setConfirming(true)}>
                  Turn on debug…
                </button>
              )}
            </>
          )}
        </div>
      )}
      {confirming && (
        <div role="alertdialog" aria-labelledby="confirm-title" className="debug-confirm stack">
          <strong id="confirm-title">
            {debugLevel} for {props.service.name}, {spans.find((span) => span.minutes === minutes)?.label}?
          </strong>
          <p className="secondary" style={{ margin: 0, fontSize: 13 }}>
            Many more lines, and more disk in the log store. It is recorded under your name, and ends at{" "}
            {clock(new Date(now() + minutes * 60_000).toISOString())}.
          </p>
          <div className="choices">
            <button
              type="button"
              className="debug-button"
              onClick={() => void actions.debug(props.service.name, minutes).then(() => setConfirming(false))}
            >
              Turn on
            </button>
            <button type="button" className="plain-button" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
