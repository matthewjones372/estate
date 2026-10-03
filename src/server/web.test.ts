import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer, Option, Result } from "effect"
import { buildWeb, builtWeb, Web } from "./web"

const read = Effect.gen(function* () {
  const web = yield* Web
  return web
})

describe("the pages' bundle", () => {
  test(
    "is built as Estate starts, with the index naming its script and styles",
    () =>
      Effect.runPromise(
        read.pipe(
          Effect.flatMap((web) =>
            Effect.sync(() => {
              const script = /src="\/assets\/([^"]+\.js)"/.exec(web.index)?.[1] ?? ""
              const styles = /href="\/assets\/([^"]+\.css)"/.exec(web.index)?.[1] ?? ""
              expect(Option.map(web.asset(script), (asset) => asset.type)).toEqual(
                Option.some("text/javascript;charset=utf-8"),
              )
              expect(Option.isSome(web.asset(styles))).toBe(true)
              expect(Option.isNone(web.asset("missing.js"))).toBe(true)
            }),
          ),
          Effect.provide(Layer.fresh(builtWeb)),
        ),
      ),
    30_000,
  )

  test("that does not build stops Estate, saying why", () => {
    const broken = mkdtempSync(join(tmpdir(), "estate-web-"))
    writeFileSync(join(broken, "main.tsx"), "import { nothing } from './nowhere'\n")
    const empty = mkdtempSync(join(tmpdir(), "estate-web-"))
    writeFileSync(join(empty, "main.tsx"), "export const page = 1\n")
    const attempt = (directory: string) =>
      Effect.runPromise(Effect.result(read.pipe(Effect.provide(buildWeb(directory)))))
    return Promise.all([attempt(broken), attempt(empty), attempt(join(broken, "gone"))]).then((results) => {
      expect(results.map((result) => Result.isFailure(result) && result.failure._tag)).toEqual([
        "WebBuildError",
        "WebBuildError",
        "WebBuildError",
      ])
    })
  })
})
