import { describe, expect, test } from "bun:test"
import { Effect, Redacted } from "effect"
import { type Call, Remote, RemoteError, reply, stubRemote } from "../remote"
import { readRunbook, textOfHtml } from "./runbook"

const read = (url: string, answer: (call: Call) => ReturnType<typeof reply> | undefined, calls: Call[] = []) =>
  Effect.runPromise(
    readRunbook(url, [{ host: "git.example", token: Redacted.make("pat") }]).pipe(
      Effect.provide(
        stubRemote((call) => {
          calls.push(call)
          return answer(call)
        }),
      ),
    ),
  )

describe("a runbook", () => {
  test("in Markdown is read as it is, with the token for its host, and cut short when long", () => {
    const calls: Call[] = []
    return Promise.all([
      read(
        "https://git.example/orders.md",
        () => reply("# Orders\n\nRoll back. ", 200, { "content-type": "text/markdown" }),
        calls,
      ),
      read("https://git.example/long.txt", () => reply("x".repeat(5000), 200, { "content-type": "text/plain" })),
    ]).then(([markdown, long]) => {
      expect(markdown).toEqual({ text: "# Orders\n\nRoll back." })
      expect(calls[0]?.headers?.["authorization"]).toBe("Bearer pat")
      expect("text" in long && long.text.length).toBe(4001)
    })
  })

  test("says why where it could not be read as text", () =>
    Promise.all([
      read("https://git.example/a.pdf", () => reply("%PDF", 200, { "content-type": "application/pdf" })),
      read("https://git.example/b", () => reply("?", 200)),
      read("https://git.example/c", () => undefined),
      read("mailto:ops@example.com", () => undefined),
      Effect.runPromise(
        readRunbook("https://other.example/d", undefined).pipe(
          Effect.provideService(Remote, {
            call: (call) => Effect.fail(new RemoteError({ url: call.url, message: "did not answer in 10 s" })),
          }),
        ),
      ),
    ]).then((reads) =>
      expect(reads).toEqual([
        { failed: "it is application/pdf, not text" },
        { failed: "it is of no stated type, not text" },
        { failed: "git.example answered 404" },
        { failed: "it is not a web page" },
        { failed: "did not answer in 10 s" },
      ]),
    ))

  test("in HTML is its text: no scripts or styles, a line a block, entities read", () =>
    expect(
      textOfHtml(
        "<head><title>t</title></head><script>x()</script><style>p{}</style><h2>Steps</h2><ul><li>Check&nbsp;the   db</li><li>Roll back &amp; tell</li></ul>",
      ),
    ).toBe("Steps\nCheck the db\nRoll back & tell"))
})
