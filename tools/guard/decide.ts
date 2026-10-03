/** Whether an agent's tool call would change the gate's configuration, which is a person's to change. */
import { isAbsolute, relative } from "node:path"

export interface ToolCall {
  readonly tool_name?: string
  readonly tool_input?: { readonly file_path?: string; readonly notebook_path?: string; readonly command?: string }
}

const guardedFiles = [
  "package.json",
  "tsconfig.json",
  "biome.json",
  "knip.json",
  ".dependency-cruiser.cjs",
  "bunfig.toml",
  ".github/workflows/gate.yml",
]
const guardedDirectories = ["tools/", ".claude/"]

const isGuarded = (path: string): boolean =>
  guardedFiles.includes(path) || guardedDirectories.some((directory) => path.startsWith(directory))

const literal = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const guardedPatterns = [
  ...guardedFiles.map((file) => `${literal(file)}($|[\\s'";|&)])`),
  ...guardedDirectories.map(literal),
]
const mentions = guardedPatterns.map((pattern) => new RegExp(`(^|[\\s'"=/])${pattern}`))
const redirectsInto = guardedPatterns.map((pattern) => new RegExp(`>{1,2}\\s*['"]?(\\S*/)?${pattern}`))

const writes =
  /\bsed\s+(-\w+\s+)*-i|\bperl\s+-\w*i|\btee\b|\b(mv|cp|rm|ln|truncate|chmod|install|rsync|dd|patch)\s|\bgit\s+(checkout|restore|rm|mv|apply|stash|reset)\b|\bpython3?\b|\b(node|bun)\s+-e\b/

const refusal = (what: string): string =>
  `${what} is the gate's configuration, which is a person's to change: say what you would change and why, and leave it to them.`

export const decide = (call: ToolCall, root: string): string | undefined => {
  const input = call.tool_input ?? {}
  if (call.tool_name === "Bash") {
    const command = input.command ?? ""
    const writesThere = writes.test(command) && mentions.some((pattern) => pattern.test(command))
    return writesThere || redirectsInto.some((pattern) => pattern.test(command))
      ? refusal("A command writing to what the gate reads")
      : undefined
  }
  const target = input.file_path ?? input.notebook_path
  if (target === undefined) return undefined
  const path = isAbsolute(target) ? relative(root, target) : target
  return isGuarded(path.replace(/^\.\//, "")) ? refusal(path) : undefined
}
