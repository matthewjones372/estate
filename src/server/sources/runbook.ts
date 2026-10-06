/**
 * A runbook's text, where its link is a page Estate can read: Markdown or plain text as it is, HTML with its markup
 * taken out. The credentials `runbooks:` gives for the link's host go to that host alone.
 */
import { Effect, Redacted } from "effect"
import { Remote } from "../remote"
import type { Settings } from "../settings"

/** As much of a runbook as a brief, or a model, needs to read. */
const longest = 4000

const entities: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " }

/** HTML's text: scripts and styles dropped, blocks on their own lines, entities read. */
export const textOfHtml = (html: string): string =>
  html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/?(p|div|li|h[1-6]|br|tr|pre|section|article)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name: string) => entities[name] ?? "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "")
    .join("\n")

const cut = (text: string) => (text.length > longest ? `${text.slice(0, longest).trimEnd()}…` : text)

const headersFor = (host: string, runbooks: Settings["runbooks"]): Readonly<Record<string, string>> => {
  const found = runbooks?.find((each) => each.host === host)
  if (found?.token === undefined) return {}
  const token = Redacted.value(found.token)
  return { authorization: found.user === undefined ? `Bearer ${token}` : `Basic ${btoa(`${found.user}:${token}`)}` }
}

export type RunbookRead = { readonly text: string } | { readonly failed: string }

export const readRunbook = (url: string, runbooks: Settings["runbooks"]): Effect.Effect<RunbookRead, never, Remote> =>
  Effect.gen(function* () {
    const parsed = URL.parse(url)
    if (parsed === null || !["http:", "https:"].includes(parsed.protocol)) return { failed: "it is not a web page" }
    const remote = yield* Remote
    const read = yield* Effect.result(
      remote.call({
        url,
        headers: { accept: "text/markdown, text/plain, text/html;q=0.9", ...headersFor(parsed.host, runbooks) },
      }),
    )
    if (read._tag === "Failure") return { failed: read.failure.message }
    const { status, headers, text } = read.success
    if (status < 200 || status > 299) return { failed: `${parsed.host} answered ${status}` }
    const type = Object.entries(headers).find(([name]) => name.toLowerCase() === "content-type")?.[1] ?? ""
    if (/text\/html/i.test(type)) return { text: cut(textOfHtml(text)) }
    if (/text\/(markdown|plain|x-markdown)/i.test(type)) return { text: cut(text.trim()) }
    return { failed: `it is ${type === "" ? "of no stated type" : type}, not text` }
  })
