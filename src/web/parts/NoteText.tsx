/** @jsxImportSource solid-js */
/**
 * A note's text as it was written, its lines kept; a long one shows its first two lines and *more*, so a kept AI
 * answer does not push a card's buttons, or the day's other changes, off the screen.
 */
import { createSignal, Show } from "solid-js"
import type { Actions } from "../context"

/** Past this many characters, or two lines, a note opens on asking. */
const longest = 160

const isLong = (text: string) => text.length > longest || text.split("\n").length > 2

export const NoteText = (props: { readonly text: string }) => {
  const [open, setOpen] = createSignal(false)
  return (
    <div class="note-text">
      <div class={`note-body${isLong(props.text) && !open() ? " clamped" : ""}`}>{props.text}</div>
      <Show when={isLong(props.text)}>
        <button type="button" class="note-more" aria-expanded={open()} onClick={() => setOpen(!open())}>
          {open() ? "less" : "more"}
        </button>
      </Show>
    </div>
  )
}

// Keyed by the page's actions, which live as long as Estate is open in the tab, and each test's are its own.
const unfolded = new WeakMap<Actions, Map<string, ReturnType<typeof createSignal<boolean>>>>()

/**
 * Whether a card's fold is open, such as its notes or all of them: kept per card while Estate is open, so moving
 * away and back keeps it.
 */
export const cardFold = (actions: Actions, card: string) => {
  const mine = unfolded.get(actions) ?? new Map()
  unfolded.set(actions, mine)
  const found = mine.get(card) ?? createSignal(false)
  mine.set(card, found)
  return found
}
