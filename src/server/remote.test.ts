import { afterAll, describe, expect, test } from "bun:test"
import { Effect, Fiber, Layer, Result } from "effect"
import { TestClock } from "effect/testing"
import { callJson, liveRemote, reply, stubRemote } from "./remote"

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch: (request) => {
    const path = new URL(request.url).pathname
    if (path === "/json") return Response.json({ said: request.method, header: request.headers.get("x-asked") })
    if (path === "/typed") return Response.json({ type: request.headers.get("content-type") })
    if (path === "/empty") return new Response("")
    if (path === "/text") return new Response("plain words")
    return new Response("broken", { status: 500 })
  },
})
afterAll(() => server.stop(true))

const call = (path: string) =>
  Effect.runPromise(
    Effect.result(
      callJson({
        url: `http://127.0.0.1:${server.port}${path}`,
        method: "POST",
        headers: { "x-asked": "yes" },
        body: "{}",
      }).pipe(Effect.provide(liveRemote)),
    ),
  )

describe("calls to other tools", () => {
  test("bring back the JSON they answer with", () =>
    call("/json").then((result) =>
      expect(Result.isSuccess(result) && result.success).toEqual({ said: "POST", header: "yes" }),
    ))

  test("send a body as the type the call says, as JSON APIs require, and as text where it says none", () =>
    Promise.all(
      [{ "Content-Type": "application/json" }, { "content-type": "application/x-amz-json-1.0" }, {}].map((headers) =>
        Effect.runPromise(
          callJson({ url: `http://127.0.0.1:${server.port}/typed`, method: "POST", headers, body: "{}" }).pipe(
            Effect.provide(liveRemote),
          ),
        ),
      ),
    ).then((answers) =>
      expect(answers).toEqual([
        { type: "application/json" },
        { type: "application/x-amz-json-1.0" },
        { type: "text/plain" },
      ]),
    ))

  test("an empty answer is nothing", () =>
    call("/empty").then((result) => expect(Result.isSuccess(result) && result.success).toBeNull()))

  test("an answer that is not JSON, or not 2xx, is an error naming the tool", () =>
    Promise.all([call("/text"), call("/broken")]).then(([text, broken]) => {
      expect(Result.isFailure(text) && text.failure.message).toBe("answered with something other than JSON")
      expect(Result.isFailure(broken) && broken.failure.message).toBe("answered 500: broken")
    }))

  test("a tool that is not there is an error, not a crash", () =>
    Effect.runPromise(
      Effect.result(
        callJson({ url: "http://127.0.0.1:1/nothing", ca: "not a certificate" }).pipe(Effect.provide(liveRemote)),
      ),
    ).then((result) => {
      expect(Result.isFailure(result) && result.failure.url).toBe("http://127.0.0.1:1/nothing")
      expect(Result.isFailure(result) && result.failure.message).toStartWith("could not reach 127.0.0.1:1: ")
    }))

  test("a stub answers what it knows, and 404 for the rest", () =>
    Effect.runPromise(
      Effect.result(
        callJson({ url: "http://x/a" }).pipe(
          Effect.provide(stubRemote((asked) => (asked.url === "http://x/b" ? reply("ok") : undefined))),
        ),
      ),
    ).then((result) => {
      expect(Result.isFailure(result) && result.failure.message).toBe("answered 404: not found")
    }))
})

describe("a tool that does not answer", () => {
  test("is given up on after ten seconds", () => {
    const silent = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => Bun.sleep(60_000).then(() => new Response("late")),
    })
    const asked = Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(Effect.result(callJson({ url: `http://127.0.0.1:${silent.port}/` })))
      yield* Effect.promise(() => Bun.sleep(20))
      yield* TestClock.adjust("11 seconds")
      return yield* Fiber.join(fiber)
    })
    return Effect.runPromise(asked.pipe(Effect.provide(Layer.merge(liveRemote, TestClock.layer())))).then((result) => {
      silent.stop(true)
      expect(Result.isFailure(result) && result.failure.message).toBe("did not answer in 10 s")
    })
  })
})
