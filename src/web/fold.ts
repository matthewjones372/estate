/** What a card or a row has open, kept while Estate is open in the tab. */
import { createSignal } from "solid-js"
import type { Actions } from "./context"

// Keyed by the page's actions, which live as long as Estate is open in the tab, and each test's are its own.
const unfolded = new WeakMap<Actions, Map<string, ReturnType<typeof createSignal<boolean>>>>()

/**
 * Whether a card's fold is open, such as its notes, all of them, or the card under its row: kept per card while
 * Estate is open, so moving away and back keeps it.
 */
export const cardFold = (actions: Actions, card: string) => {
  const mine = unfolded.get(actions) ?? new Map()
  unfolded.set(actions, mine)
  const found = mine.get(card) ?? createSignal(false)
  mine.set(card, found)
  return found
}
