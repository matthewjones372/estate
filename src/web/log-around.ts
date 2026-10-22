/**
 * The lines to show around each match, as `grep -C`: up to `count` either side of it, whatever they are, runs that
 * meet joined, and a gap marked where held lines were skipped between runs.
 */
export type Around<A> = { readonly item: A; readonly match: boolean; readonly gap: boolean }

export const around = <A>(
  items: ReadonlyArray<A>,
  matches: (item: A) => boolean,
  count: number,
): ReadonlyArray<Around<A>> => {
  const matched = items.map(matches)
  const near = new Array<boolean>(items.length).fill(false)
  matched.forEach((match, index) => {
    if (!match) return
    for (let each = Math.max(0, index - count); each <= Math.min(items.length - 1, index + count); each += 1)
      near[each] = true
  })
  const rows: Array<Around<A>> = []
  let last = -1
  items.forEach((item, index) => {
    if (!near[index]) return
    rows.push({ item, match: matched[index] === true, gap: count > 0 && last !== -1 && index > last + 1 })
    last = index
  })
  return rows
}
