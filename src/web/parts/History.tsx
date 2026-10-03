/** @jsxImportSource solid-js */
/**
 * Whether an alert has fired before: how often, when last and for how long, and the last note written about it; and
 * its earlier firings, each with who silenced it and why, and its notes.
 */
import { createSignal, For, Show } from "solid-js"
import type { Alert } from "../../shared/events"
import { useEstate } from "../context"
import { day, duration, since } from "../format"

type Firing = NonNullable<Alert["history"]>[number]

const lasted = (firing: Firing) =>
  firing.endsAt === undefined ? "its end not seen" : duration(Date.parse(firing.endsAt) - Date.parse(firing.startsAt))

export const History = (props: { readonly alert: Alert }) => {
  const { now } = useEstate()
  const [open, setOpen] = createSignal(false)
  const history = () => props.alert.history ?? []
  const lastNote = () => history().flatMap((firing) => firing.notes)[0]
  return (
    <Show when={history()[0]}>
      {(last) => (
        <div class="alert-before">
          <p class="alert-impact">
            <span class="alert-label">Before</span>
            <span>
              {history().length === 1 ? "once" : `${history().length} times`}, last {since(last().startsAt, now())} ago
              {last().endsAt === undefined ? "" : ` for ${lasted(last())}`}
            </span>
            <button type="button" class="plain-button" aria-expanded={open()} onClick={() => setOpen(!open())}>
              {open() ? "Hide history" : "History"}
            </button>
          </p>
          <Show when={lastNote()}>
            {(note) => (
              <p class="alert-detail">
                “{note().text}” — {note().by}, {since(note().at, now())} ago
              </p>
            )}
          </Show>
          <Show when={open()}>
            <ol class="alert-history" aria-label={`Earlier firings of ${props.alert.name}`}>
              <For each={history()}>
                {(firing) => (
                  <li>
                    <span class="mono">{day(firing.startsAt)}</span>
                    <span>{lasted(firing)}</span>
                    <Show when={firing.silence}>
                      {(silence) => (
                        <span class="muted">
                          silenced by {silence().by}: “{silence().reason}”
                        </span>
                      )}
                    </Show>
                    <For each={firing.notes}>
                      {(note) => (
                        <span>
                          “{note.text}” — {note.by}
                        </span>
                      )}
                    </For>
                  </li>
                )}
              </For>
            </ol>
          </Show>
        </div>
      )}
    </Show>
  )
}
