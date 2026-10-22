/** @jsxImportSource solid-js */
/** The overview's one place to choose how it is drawn (spec 0068): the map's layout and the services'. */
import { createSignal, For, onCleanup, onMount } from "solid-js"
import type { Choice, MapLayout, ServicesLayout } from "../view-choices"

const Options = <Value extends string>(props: { readonly legend: string; readonly choice: Choice<Value> }) => (
  <fieldset class="choices bare view-choice">
    <legend class="muted small">{props.legend}</legend>
    <For each={props.choice.options}>
      {(each) => (
        <button
          type="button"
          class="choice"
          aria-pressed={props.choice.chosen() === each.value}
          onClick={() => props.choice.choose(each.value)}
        >
          {each.label}
        </button>
      )}
    </For>
  </fieldset>
)

/** A popover, so Escape or a click elsewhere closes it and no parent's overflow clips it. */
export const ViewMenu = (props: { readonly map: Choice<MapLayout>; readonly services: Choice<ServicesLayout> }) => {
  const [open, setOpen] = createSignal(false)
  let button: HTMLButtonElement | undefined
  let body: HTMLDivElement | undefined
  // Under its button, at its end: anchor positioning does it where there is any, and this where there is none.
  const place = (event: Event) => {
    const opening = (event as ToggleEvent).newState === "open"
    setOpen(opening)
    if (!opening || button === undefined || body === undefined || CSS.supports("position-area", "block-end")) return
    const below = button.getBoundingClientRect()
    body.style.top = `${below.bottom + 6}px`
    body.style.right = `${Math.max(8, window.innerWidth - below.right)}px`
  }
  onMount(() => body?.addEventListener("toggle", place))
  onCleanup(() => body?.removeEventListener("toggle", place))
  return (
    <div class="view-menu">
      <button
        ref={button}
        type="button"
        class="plain-button view-menu-button"
        popovertarget="view-menu"
        aria-expanded={open()}
      >
        View
      </button>
      <div ref={body} id="view-menu" popover="auto" class="view-menu-body">
        <Options legend="Draw the estate as" choice={props.map} />
        <Options legend="Services as" choice={props.services} />
      </div>
    </div>
  )
}
