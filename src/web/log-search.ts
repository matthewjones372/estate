/**
 * The logs' search: text with `*` for anything within a line, or a regular expression between slashes, case aside.
 * A pattern that is not one hides nothing, so a half-typed one never empties the list.
 */
export type Search =
  | { readonly _tag: "Empty" }
  | { readonly _tag: "Pattern"; readonly pattern: RegExp }
  | { readonly _tag: "Invalid"; readonly reason: string }

const empty: Search = { _tag: "Empty" }

const wildcard = (typed: string) =>
  typed
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*?")

export const searchOf = (typed: string): Search => {
  const trimmed = typed.trim()
  if (trimmed === "") return empty
  const regular = trimmed.length > 2 && trimmed.startsWith("/") && trimmed.endsWith("/")
  const source = regular ? trimmed.slice(1, -1) : wildcard(trimmed)
  try {
    return { _tag: "Pattern", pattern: new RegExp(source, "i") }
  } catch (error) {
    return { _tag: "Invalid", reason: error instanceof Error ? error.message : String(error) }
  }
}

/** Whether a line stays shown under the search. */
export const shows = (search: Search, text: string) => search._tag !== "Pattern" || search.pattern.test(text)

/** A line cut where the search matched it, the matched parts marked; empty matches mark nothing. */
export const marked = (
  text: string,
  search: Search,
): ReadonlyArray<{ readonly text: string; readonly mark: boolean }> => {
  if (search._tag !== "Pattern") return [{ text, mark: false }]
  const parts: Array<{ text: string; mark: boolean }> = []
  let from = 0
  for (const found of text.matchAll(new RegExp(search.pattern.source, "gi"))) {
    if (found[0] === "") continue
    if (found.index > from) parts.push({ text: text.slice(from, found.index), mark: false })
    parts.push({ text: found[0], mark: true })
    from = found.index + found[0].length
  }
  if (from < text.length || parts.length === 0) parts.push({ text: text.slice(from), mark: false })
  return parts
}
