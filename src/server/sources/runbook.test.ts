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

  test("on GitHub is its raw file: from raw.githubusercontent.com without a token, the contents API with one", () => {
    const calls: Call[] = []
    const link = "https://github.com/acme/shop/blob/main/docs/run%20book.md?plain=1#steps"
    const file = (call: Call) =>
      call.url === "https://raw.githubusercontent.com/acme/shop/main/docs/run%20book.md"
        ? reply("# Orders\n\nRoll back.", 200, { "content-type": "text/plain; charset=utf-8" })
        : call.url === "https://api.github.com/repos/acme/shop/contents/docs/run%20book.md?ref=main"
          ? reply("# Orders\n\nRoll back.", 200, { "content-type": "application/vnd.github.raw; charset=utf-8" })
          : undefined
    const readWith = (runbooks: Parameters<typeof readRunbook>[1]) =>
      Effect.runPromise(
        readRunbook(link, runbooks).pipe(
          Effect.provide(
            stubRemote((call) => {
              calls.push(call)
              return file(call)
            }),
          ),
        ),
      )
    return readWith(undefined)
      .then((open) => readWith([{ host: "github.com", token: Redacted.make("ghp") }]).then((token) => [open, token]))
      .then(([open, token]) => {
        expect(open).toEqual({ text: "# Orders\n\nRoll back." })
        expect(token).toEqual({ text: "# Orders\n\nRoll back." })
        expect(calls.map((call) => call.headers?.["authorization"])).toEqual([undefined, "Bearer ghp"])
        expect(calls[1]?.headers?.["accept"]).toBe("application/vnd.github.raw")
      })
  })

  test("on GitHub but not a file is read as the link, and a private one not found says which host", () => {
    const calls: Call[] = []
    return Promise.all([
      read("https://github.com/acme/shop", () => reply("<p>Shop</p>", 200, { "content-type": "text/html" }), calls),
      Effect.runPromise(
        readRunbook("https://github.com/acme/secret/blob/main/run.md", [
          { host: "github.com", token: Redacted.make("ghp") },
        ]).pipe(Effect.provide(stubRemote(() => undefined))),
      ),
    ]).then(([page, missing]) => {
      expect(page).toEqual({ text: "Shop" })
      expect(calls.map((call) => call.url)).toEqual(["https://github.com/acme/shop"])
      expect(missing).toEqual({ failed: "api.github.com answered 404" })
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
