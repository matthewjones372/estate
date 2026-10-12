/**
 * A runbook's text, where its link is a page Estate can read: Markdown or plain text as it is, HTML with its markup
 * taken out. The credentials `runbooks:` gives for the link's host go to that host alone, except that GitHub's
 * go to its API.
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

/** Where a link's text is read from, and whether whatever answers is text. */
type Source = { readonly url: string; readonly headers: Readonly<Record<string, string>>; readonly raw: boolean }

const githubFile = /^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/

/**
 * A file on GitHub is read as the file, not GitHub's page about it: through the contents API with the token for
 * github.com, so a private repository answers, and from raw.githubusercontent.com with nothing without one.
 */
const sourceOf = (parsed: URL, runbooks: Settings["runbooks"]): Source => {
  const file = parsed.host === "github.com" ? githubFile.exec(parsed.pathname) : null
  if (file === null) {
    return {
      url: parsed.href,
      headers: { accept: "text/markdown, text/plain, text/html;q=0.9", ...headersFor(parsed.host, runbooks) },
      raw: false,
    }
  }
  const [, owner, repo, ref, path] = file
  const credentials = headersFor(parsed.host, runbooks)
  return "authorization" in credentials
    ? {
        url: `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${ref}`,
        headers: { accept: "application/vnd.github.raw", ...credentials },
        raw: true,
      }
    : { url: `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`, headers: {}, raw: true }
}

export type RunbookRead = { readonly text: string } | { readonly failed: string }

export const readRunbook = (url: string, runbooks: Settings["runbooks"]): Effect.Effect<RunbookRead, never, Remote> =>
  Effect.gen(function* () {
    const parsed = URL.parse(url)
    if (parsed === null || !["http:", "https:"].includes(parsed.protocol)) return { failed: "it is not a web page" }
    const source = sourceOf(parsed, runbooks)
    const remote = yield* Remote
    const read = yield* Effect.result(remote.call({ url: source.url, headers: source.headers }))
    if (read._tag === "Failure") return { failed: read.failure.message }
    const { status, headers, text } = read.success
    if (status < 200 || status > 299) return { failed: `${new URL(source.url).host} answered ${status}` }
    if (source.raw) return { text: cut(text.trim()) }
    const type = Object.entries(headers).find(([name]) => name.toLowerCase() === "content-type")?.[1] ?? ""
    if (/text\/html/i.test(type)) return { text: cut(textOfHtml(text)) }
    if (/text\/(markdown|plain|x-markdown)/i.test(type)) return { text: cut(text.trim()) }
    return { failed: `it is ${type === "" ? "of no stated type" : type}, not text` }
  })
