/** @jsxImportSource solid-js */
/**
 * Tell the team that owns an alert's service, in its Slack channel, once a firing; after that, a link to the thread,
 * where the firing's notes, silences and end follow.
 */
import { createSignal, Show } from "solid-js"
import type { Alert } from "../../shared/events"
import { useEstate } from "../context"
import { Out } from "./A"

export const TellTeam = (props: {
  readonly alert: Alert
  /** The owning team's name as the page shows it, where it has a Slack channel. */
  readonly team: string | undefined
}) => {
  const { me, actions } = useEstate()
  const [telling, setTelling] = createSignal(false)
  const [refused, setRefused] = createSignal<string | undefined>(undefined)
  const tell = () => {
    setTelling(true)
    setRefused(undefined)
    void actions.tell(props.alert.id).then((told) => {
      setTelling(false)
      if (typeof told === "string") setRefused(told)
    })
  }
  return (
    <Show
      when={props.alert.thread}
      fallback={
        <Show when={me.slack === true && me.kiosk !== true ? props.team : undefined}>
          {(team) => (
            <>
              <button type="button" class="amber-button ghost" disabled={telling()} onClick={tell}>
                {telling() ? "Telling…" : `Tell ${team()} on Slack`}
              </button>
              <Show when={refused()}>
                {(why) => (
                  <span class="alert-quiet" role="alert">
                    {why()}
                  </span>
                )}
              </Show>
            </>
          )}
        </Show>
      }
    >
      {(thread) => (
        <Out href={thread().url} class="amber-button ghost">
          The thread in Slack
        </Out>
      )}
    </Show>
  )
}
