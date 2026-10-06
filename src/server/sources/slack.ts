/**
 * Slack, written to only when someone asks: a message in a team's channel, its link, and replies in its thread. Every
 * answer is decoded, and Slack's own `ok: false` is a failure in Slack's words.
 */
import { Effect, Redacted, Schema } from "effect"
import { callJson, type Remote } from "../remote"
import { type Failure, SourceFailure } from "./run"

export interface SlackSettings {
  readonly token: Redacted.Redacted<string>
  readonly url?: string
}

const Posted = Schema.Struct({
  ok: Schema.Boolean,
  error: Schema.optionalKey(Schema.String),
  channel: Schema.optionalKey(Schema.String),
  ts: Schema.optionalKey(Schema.String),
})
const Linked = Schema.Struct({
  ok: Schema.Boolean,
  error: Schema.optionalKey(Schema.String),
  permalink: Schema.optionalKey(Schema.String),
})

const base = (slack: SlackSettings) => (slack.url ?? "https://slack.com/api").replace(/\/$/, "")
const auth = (slack: SlackSettings) => ({ authorization: `Bearer ${Redacted.value(slack.token)}` })

const failed = (error: { readonly _tag: string; readonly message: string }) =>
  new SourceFailure({
    message: error._tag === "RemoteError" ? `Slack ${error.message}` : "Slack answered in a shape Estate does not know",
  })

/** The channel a team's Slack link names: `https://example.slack.com/archives/C0PAY` is `C0PAY`. */
export const channelOf = (link: string | undefined): string | undefined =>
  link === undefined ? undefined : /\/archives\/([A-Z0-9]+)/.exec(link)?.[1]

/** Posts `text` to `channel`, or in reply in the thread `ts` names, and says where it went. */
export const post = (
  slack: SlackSettings,
  channel: string,
  text: string,
  thread?: string,
): Effect.Effect<{ readonly channel: string; readonly ts: string }, Failure, Remote> =>
  Effect.gen(function* () {
    const answer = yield* callJson({
      url: `${base(slack)}/chat.postMessage`,
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8", ...auth(slack) },
      body: JSON.stringify({
        channel,
        text,
        unfurl_links: false,
        ...(thread === undefined ? {} : { thread_ts: thread }),
      }),
    }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Posted)), Effect.mapError(failed))
    if (!answer.ok || answer.ts === undefined)
      return yield* new SourceFailure({ message: `Slack refused the message: ${answer.error ?? "no reason given"}` })
    return { channel: answer.channel ?? channel, ts: answer.ts }
  })

/** The link to a message, for the card to open. */
export const permalink = (slack: SlackSettings, channel: string, ts: string): Effect.Effect<string, Failure, Remote> =>
  Effect.gen(function* () {
    const answer = yield* callJson({
      url: `${base(slack)}/chat.getPermalink?channel=${encodeURIComponent(channel)}&message_ts=${encodeURIComponent(ts)}`,
      headers: auth(slack),
    }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Linked)), Effect.mapError(failed))
    if (!answer.ok || answer.permalink === undefined)
      return yield* new SourceFailure({
        message: `Slack gave no link to the message: ${answer.error ?? "no reason given"}`,
      })
    return answer.permalink
  })
