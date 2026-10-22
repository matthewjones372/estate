/**
 * The lines to show around each match, as `grep -B` and `-A`: up to `before` ahead of it and `after` behind, whatever
 * they are, runs that meet joined, and a gap marked where held lines were skipped between runs.
 */
export type Around<A> = { readonly item: A; readonly match: boolean; readonly gap: boolean }
export type Reach = { readonly before: number; readonly after: number }

export const around = <A>(
  items: ReadonlyArray<A>,
  matches: (item: A) => boolean,
  reach: Reach,
): ReadonlyArray<Around<A>> => {
  const matched = items.map(matches)
  const near = new Array<boolean>(items.length).fill(false)
  matched.forEach((match, index) => {
    if (!match) return
    const last = Math.min(items.length - 1, index + reach.after)
    for (let each = Math.max(0, index - reach.before); each <= last; each += 1) near[each] = true
  })
  const reaching = reach.before + reach.after > 0
  const rows: Array<Around<A>> = []
  let last = -1
  items.forEach((item, index) => {
    if (!near[index]) return
    rows.push({ item, match: matched[index] === true, gap: reaching && last !== -1 && index > last + 1 })
    last = index
  })
  return rows
}
