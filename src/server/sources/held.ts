/**
 * Silences Estate has just written or ended, held on the page until the manager's answer agrees. Without the hold, a
 * read of the alerts that comes before the manager has the write shows the alert as it was until the read after.
 */
import { Duration } from "effect"
import type { EnvironmentState, Held, SourcedAlert } from "../state"
import { after, iso } from "../time"

type Silence = NonNullable<SourcedAlert["silence"]>

const holdFor = Duration.minutes(2)

const agrees = (alert: SourcedAlert, held: Held): boolean =>
  held.silence === undefined ? alert.silence?.id !== held.ended : alert.silence?.id === held.silence.id

const asHeld = (alert: SourcedAlert, held: Held): SourcedAlert => {
  if (held.silence !== undefined) return { ...alert, state: "silenced", silence: held.silence }
  const { silence: _, ...unsilenced } = alert
  return { ...unsilenced, state: held.was }
}

/** The environment with `change` held for its alert from `now`, replacing what was held for it before. */
const hold = (state: EnvironmentState, change: Omit<Held, "until">, now: number): EnvironmentState => {
  const held = { ...change, until: iso(after(now, holdFor)) }
  return {
    ...state,
    alerts:
      state.alerts.value === undefined
        ? state.alerts
        : {
            ...state.alerts,
            value: state.alerts.value.map((alert) => (alert.id === change.alert ? asHeld(alert, held) : alert)),
          },
    held: [...(state.held ?? []).filter((each) => each.alert !== change.alert), held],
  }
}

/** The environment with its alert silenced by Estate, held until the manager has the silence. */
export const holdSilence = (state: EnvironmentState, alert: SourcedAlert, silence: Silence, now: number) =>
  hold(state, { alert: alert.id, was: alert.state === "silenced" ? "firing" : alert.state, silence }, now)

/**
 * The environment with the silence `id` ended by Estate, each alert it silenced back in the state it had before:
 * the state held from Estate's own silence, or firing, since Alertmanager and Datadog only hold firing alerts.
 */
export const holdUnsilence = (state: EnvironmentState, id: string, now: number): EnvironmentState =>
  (state.alerts.value ?? [])
    .filter((alert) => alert.silence?.id === id)
    .reduce(
      (held, alert) =>
        hold(
          held,
          { alert: alert.id, was: state.held?.find((each) => each.alert === alert.id)?.was ?? "firing", ended: id },
          now,
        ),
      state,
    )

/** After a read of the alerts: each write still held shown as Estate made it, until the read agrees or time is up. */
export const keepHeld = (state: EnvironmentState, at: string): EnvironmentState => {
  const alerts = new Map((state.alerts.value ?? []).map((alert) => [alert.id, alert]))
  const still = (state.held ?? []).filter((held) => {
    const alert = alerts.get(held.alert)
    return held.until > at && alert !== undefined && !agrees(alert, held)
  })
  if (still.length === 0 && state.held === undefined) return state
  const byAlert = new Map(still.map((held) => [held.alert, held]))
  return {
    ...state,
    alerts:
      state.alerts.value === undefined || still.length === 0
        ? state.alerts
        : {
            ...state.alerts,
            value: state.alerts.value.map((alert) => {
              const held = byAlert.get(alert.id)
              return held === undefined ? alert : asHeld(alert, held)
            }),
          },
    held: still,
  }
}
