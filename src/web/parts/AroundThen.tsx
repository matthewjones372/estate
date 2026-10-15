/** @jsxImportSource solid-js */
/** What was around a past firing, from what Estate still holds: what changed before it, and what sits next to it. */
import { For, Show } from "solid-js"
import type { PastFiring } from "../../shared/firing"
import { clock } from "../format"
import { pathOf } from "../route"
import { A, Out } from "./A"

export const AroundThen = (props: { readonly around: NonNullable<PastFiring["around"]> }) => (
  <section aria-labelledby="firing-around" class="panel section-box stack">
    <h2 id="firing-around" class="section-title">
      Around it then
    </h2>
    <Show
      when={props.around.changed.length > 0}
      fallback={
        <p class="muted" style={{ margin: 0 }}>
          Nothing Estate holds changed in the hour before it fired.
        </p>
      }
    >
      <ol class="alert-history" aria-label="Changed in the hour before it fired">
        <For each={props.around.changed}>
          {(change) => (
            <li>
              <span class="mono">{clock(change.at)}</span>
              <Show when={change.url} fallback={<span>{`${change.service} ${change.text}`}</span>}>
                {(url) => <Out href={url()}>{`${change.service} ${change.text}`}</Out>}
              </Show>
            </li>
          )}
        </For>
      </ol>
    </Show>
    <For each={props.around.unseen}>
      {(unseen) => (
        <p class="muted" style={{ margin: 0 }}>
          Deploys of {unseen.service} before {unseen.version} are not kept here.
        </p>
      )}
    </For>
    <Show when={props.around.neighbours.length > 0}>
      <p class="alert-impact">
        <span class="alert-label">Around</span>
        <span>
          <For each={props.around.neighbours}>
            {(neighbour, index) => (
              <>
                {index() === 0 ? "" : ", "}
                <A to={pathOf({ page: neighbour.kind, name: neighbour.name })}>{neighbour.name}</A>
              </>
            )}
          </For>
        </span>
      </p>
    </Show>
  </section>
)
