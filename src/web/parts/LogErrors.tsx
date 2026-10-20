/** @jsxImportSource solid-js */
/** A service's errors over a window, grouped by message. */
import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js"
import type { ErrorGroups } from "../../shared/log-events"
import { type ErrorWindow, useEstate, useSnapshot } from "../context"
import { since } from "../format"
import { asText, copy } from "../log-copy"
import { type ErrorRange, errorRanges } from "../route"
import { IncludeInIncident } from "./IncludeInIncident"
import { LineRow } from "./LogLine"

/** The errors in a window, grouped: the commonest first, each opening to its newest examples. */
export const ErrorList = (props: {
  readonly service: string
  readonly window: ErrorWindow
  readonly most?: number
}) => {
  const { actions, now } = useEstate()
  const snapshot = useSnapshot()
  const [groups, setGroups] = createSignal<ErrorGroups | "none" | "loading" | undefined>("loading")
  const [open, setOpen] = createSignal<string | undefined>(undefined)
  createEffect(
    on([() => props.service, () => JSON.stringify(props.window)], ([service]) => {
      let current = true
      setGroups("loading")
      void actions.errors(service, props.window).then((read) => {
        if (current) setGroups(read)
      })
      onCleanup(() => {
        current = false
      })
    }),
  )
  const read = () => {
    const value = groups()
    return typeof value === "object" ? value : undefined
  }
  return (
    <Show
      when={read()}
      fallback={
        <p class="muted" style={{ margin: 0 }}>
          {groups() === "loading"
            ? "Reading the errors…"
            : groups() === "none"
              ? `No logs are read for ${props.service} here, or they are kept to operators.`
              : "The logs did not answer."}
        </p>
      }
    >
      {(found) => (
        <>
          <Show when={"until" in props.window && found().from === "the cluster"}>
            <p class="muted" style={{ margin: 0 }}>
              Read from the pods running now, so lines from before they started are not here.
            </p>
          </Show>
          <Show
            when={found().groups.length > 0}
            fallback={
              <p class="muted" style={{ margin: 0 }}>
                No errors.
              </p>
            }
          >
            <ol class="error-groups">
              <For each={found().groups.slice(0, props.most ?? 50)}>
                {(group) => (
                  <li class="error-group">
                    <button
                      type="button"
                      class="error-head"
                      aria-expanded={open() === group.shape}
                      onClick={() => setOpen(open() === group.shape ? undefined : group.shape)}
                    >
                      <span class="error-count">{group.count}×</span>
                      <span class="mono error-shape">{group.shape}</span>
                      <span class="muted error-when">
                        last {since(group.lastSeen, now())} ago · {group.pods.join(", ")}
                      </span>
                    </button>
                    <Show when={open() === group.shape}>
                      <ol class="log-lines examples">
                        <For each={group.examples}>{(line) => <LineRow line={line} />}</For>
                      </ol>
                      <button
                        type="button"
                        class="plain-button log-copy-examples"
                        onClick={() => void copy(asText(group.examples))}
                      >
                        Copy these lines
                      </button>
                      <IncludeInIncident
                        label="Include this error…"
                        what={() => ({
                          kind: "errors",
                          environment: snapshot.environment,
                          service: props.service,
                          group,
                        })}
                      />
                    </Show>
                  </li>
                )}
              </For>
            </ol>
          </Show>
        </>
      )}
    </Show>
  )
}

export const Errors = (props: {
  readonly service: string
  readonly range: ErrorRange
  readonly choose: (range: ErrorRange) => void
}) => {
  return (
    <div class="stack">
      <fieldset class="choices bare">
        <legend class="visually-hidden">Over</legend>
        <For each={errorRanges}>
          {(each) => (
            <button type="button" class="filter" aria-pressed={props.range === each} onClick={() => props.choose(each)}>
              {each}
            </button>
          )}
        </For>
      </fieldset>
      <ErrorList service={props.service} window={{ range: props.range }} />
    </div>
  )
}
