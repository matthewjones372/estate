import { describe, expect, test } from "bun:test"
import { Effect, Redacted } from "effect"
import { reply, stubRemote } from "../remote"
import { channelOf, permalink, post } from "./slack"

const slack = { token: Redacted.make("xoxb") }
const answering = (body: unknown, status = 200) => Effect.provide(stubRemote(() => reply(body, status)))

describe("Slack", () => {
  test("names the channel a team's Slack link points at", () => {
    expect(channelOf("https://example.slack.com/archives/C0PAY")).toBe("C0PAY")
    expect(channelOf("https://example.slack.com/archives/C0PAY/p123")).toBe("C0PAY")
    expect(channelOf("https://example.slack.com/channels/payments")).toBeUndefined()
    expect(channelOf(undefined)).toBeUndefined()
  })

  test("replies in a thread, and says why where it gave no link or answered oddly", () =>
    Promise.all([
      Effect.runPromise(
        post(slack, "C0PAY", "on it", "1.2").pipe(
          Effect.provide(stubRemote((call) => reply({ ok: true, ts: "1.3", body: call.body }))),
        ),
      ),
      Effect.runPromise(
        Effect.flip(permalink(slack, "C0PAY", "1.2").pipe(answering({ ok: false, error: "message_not_found" }))),
      ),
      Effect.runPromise(Effect.flip(post(slack, "C0PAY", "x").pipe(answering({ ok: "yes" })))),
      Effect.runPromise(Effect.flip(post(slack, "C0PAY", "x").pipe(answering("down", 503)))),
      Effect.runPromise(Effect.flip(post(slack, "C0PAY", "x").pipe(answering({ ok: false })))),
    ]).then(([replied, unlinked, odd, down, unexplained]) => {
      expect(replied).toEqual({ channel: "C0PAY", ts: "1.3" })
      expect([unlinked.message, odd.message, down.message, unexplained.message]).toEqual([
        "Slack gave no link to the message: message_not_found",
        "Slack answered in a shape Estate does not know",
        "Slack answered 503: down",
        "Slack refused the message: no reason given",
      ])
    }))
})
