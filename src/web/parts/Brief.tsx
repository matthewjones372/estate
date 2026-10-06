/** @jsxImportSource solid-js */
/**
 * *Around this alert*, as the server gathered it: what changed near it, what sits next to it and how that is, its
 * errors from just before it fired, and its runbook's text.
 */
import { For, Show } from "solid-js"
import type { AroundAlert, Change } from "../../shared/around"
import { clock, duration, measured } from "../format"
import { Out } from "./A"

/** "2 min before it fired", or "4 min after", from the alert's start. */
const whenOf = (change: Change, startsAt: string) => {
  const gap = Date.parse(startsAt) - Date.parse(change.at)
  return gap >= 0 ? `${duration(gap)} before it fired` : `${duration(-gap)} after`
}

export const Brief = (props: { readonly brief: AroundAlert }) => {
  const errors = () => {
    const read = props.brief.errors
    return read !== undefined && "groups" in read ? read : undefined
  }
  const failed = () => {
    const read = props.brief.errors
    return read !== undefined && "failed" in read ? read.failed : undefined
  }
  return (
    <dl class="around">
      <dt class="alert-label">Changed</dt>
      <dd>
        <Show
          when={props.brief.changed.length > 0}
          fallback={<span class="muted">Nothing deployed or built near it.</span>}
        >
          <ul>
            <For each={props.brief.changed}>
              {(change) => (
                <li>
                  <strong>{change.service}</strong>{" "}
                  <Show when={change.url} fallback={change.text}>
                    {(url) => <Out href={url()}>{change.text}</Out>}
                  </Show>{" "}
                  <span class="muted">
                    {clock(change.at)}, {whenOf(change, props.brief.startsAt)}
                  </span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </dd>
      <Show when={props.brief.depends.length > 0}>
        <dt class="alert-label">Depends</dt>
        <dd>
          <ul>
            <For each={props.brief.depends}>
              {(neighbour) => (
                <li>
                  <strong>{neighbour.name}</strong> <span class="muted">{neighbour.side}</span>{" "}
                  <span class={`health-word ${neighbour.health}`}>{neighbour.health}</span>
                  <For each={neighbour.readings}>
                    {(reading) => (
                      <span class="mono">
                        {" "}
                        · {reading.title} {measured(reading.now, reading.unit)}
                      </span>
                    )}
                  </For>
                  <Show when={neighbour.reasons.length > 0}>
                    <span class="muted">: {neighbour.reasons.join(", ")}</span>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </dd>
      </Show>
      <Show when={errors() ?? failed()}>
        <dt class="alert-label">Errors</dt>
        <dd>
          <Show when={errors()} fallback={<span class="muted">The logs did not answer: {failed()}</span>}>
            {(read) => (
              <Show
                when={read().groups.length > 0}
                fallback={<span class="muted">None from ten minutes before it fired, in {read().from}.</span>}
              >
                <ul>
                  <For each={read().groups.slice(0, 3)}>
                    {(group) => (
                      <li>
                        <span class="mono">“{group.shape}”</span> <span class="muted">×{group.count}</span>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            )}
          </Show>
        </dd>
      </Show>
      <Show when={props.brief.runbook}>
        {(runbook) => (
          <>
            <dt class="alert-label">Runbook</dt>
            <dd>
              <Show
                when={runbook().text}
                fallback={
                  <span class="muted">
                    Not read{runbook().failed === undefined ? "" : `: ${runbook().failed}`}.{" "}
                    <Out href={runbook().url}>Open it</Out>
                  </span>
                }
              >
                {(text) => (
                  <>
                    <blockquote class="around-runbook">{text()}</blockquote>
                    <Out href={runbook().url}>{runbook().url}</Out>
                  </>
                )}
              </Show>
            </dd>
          </>
        )}
      </Show>
    </dl>
  )
}
