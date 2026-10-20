/**
 * Moving to another page: a cross-fade where the browser has view transitions and the person has not asked for less
 * motion, and an instant swap otherwise; either way focus moves to the new page, once the fade is done (spec 0056).
 */

/** The little of the document a move needs, so a test can stand in for it. */
export interface Movable {
  readonly activeElement: Element | null
  readonly getElementById: (id: string) => HTMLElement | null
  readonly startViewTransition?: (update: () => void) => { readonly finished: Promise<void> }
}

const still = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches

export const moveTo = (update: () => void, page: Movable = document, lessMotion: () => boolean = still) => {
  // Only from where the move began: focus the person put elsewhere during the fade (the jump field, say) stays.
  const from = page.activeElement
  const focus = () => {
    if (page.activeElement === from) page.getElementById("content")?.focus({ preventScroll: true })
  }
  if (page.startViewTransition === undefined || lessMotion()) {
    update()
    focus()
    return
  }
  void page.startViewTransition(update).finished.finally(focus)
}
