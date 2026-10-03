/** What the slop check refuses, as a pure function of a file's path and text. */

export interface Finding {
  readonly path: string
  readonly line: number
  readonly rule: string
}

const maxLines = 300

const everywhere: ReadonlyArray<readonly [string, RegExp]> = [
  ["a TODO or FIXME", /\b(TODO|FIXME|XXX|HACK)\b/],
  ["placeholder text", /lorem ipsum|\bTBD\b|not (yet )?implemented|implement me|your code here|rest of (the )?code/i],
  ["a skipped or focused test", /\b(test|it|describe)\.(skip|only|todo)\b/],
  ["a rule switched off inline", /biome-ignore|@ts-(ignore|expect-error|nocheck)|eslint-disable/],
]

// Server and shared code is Effect: failures are typed errors, and asynchrony is an Effect, not a promise.
const effectOnly: ReadonlyArray<readonly [string, RegExp]> = [
  ["throw, where Effect.fail belongs", /\bthrow\b/],
  ["try, where Effect.try or catchTag belongs", /\btry\s*\{/],
  ["async, where Effect.gen belongs", /\basync\b/],
  ["new Promise, where Effect.async belongs", /\bnew Promise\b/],
]

const runsAnEffect = /\bEffect\.run(Promise|Sync|Fork|Callback|PromiseExit|SyncExit|Main)\b/

const looksLikeCode = [
  /^(const|let|var)\s+[\w{[]/,
  /^(import|export)\s.*\bfrom\s/,
  /^(if|for|while|switch)\s*\(/,
  /^return\b.*;$/,
  /^[\w.$]+\(.*\);?$/,
  /[;{]$/,
  /^}\)?;?$/,
]

const commentBody = (line: string): string | undefined => {
  const trimmed = line.trim()
  if (trimmed.startsWith("//")) return trimmed.slice(2).trim()
  if (trimmed.startsWith("* ")) return trimmed.slice(2).trim()
  return undefined
}

const isTest = (path: string): boolean => /\.test\.tsx?$/.test(path)
const isEffectOnly = (path: string): boolean => /^src\/(server|shared)\//.test(path)
const isEntry = (path: string): boolean => path === "src/server/main.ts"

export const findSlop = (path: string, text: string): ReadonlyArray<Finding> => {
  const lines = text.split("\n")
  const findings: Finding[] = []
  const found = (line: number, rule: string) => findings.push({ path, line, rule })

  const length = text.endsWith("\n") ? lines.length - 1 : lines.length
  if (length > maxLines) found(maxLines + 1, `a file over ${maxLines} lines`)

  lines.forEach((text, index) => {
    const line = index + 1
    for (const [rule, pattern] of everywhere) if (pattern.test(text)) found(line, rule)
    if (isEffectOnly(path)) for (const [rule, pattern] of effectOnly) if (pattern.test(text)) found(line, rule)
    if (path.startsWith("src/") && !isTest(path) && !isEntry(path) && runsAnEffect.test(text)) {
      found(line, "an Effect run outside the entry")
    }
    const comment = commentBody(text)
    if (comment !== undefined && looksLikeCode.some((pattern) => pattern.test(comment))) {
      found(line, "commented-out code")
    }
  })
  return findings
}

/** The slop check's own rules and their tests name what they refuse, so they are not held to them. */
export const isChecked = (path: string): boolean =>
  /\.(ts|tsx|js|cjs|mjs|css|html)$/.test(path) && !path.startsWith("tools/slop/")
