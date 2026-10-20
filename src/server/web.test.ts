import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer, Option, Result } from "effect"
import { bundle, print } from "./bundle"
import { platform } from "./platform"
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
          Effect.provide(Layer.fresh(builtWeb).pipe(Layer.provide(platform))),
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
      Effect.runPromise(Effect.result(read.pipe(Effect.provide(buildWeb(directory).pipe(Layer.provide(platform))))))
    return Promise.all([attempt(broken), attempt(empty), attempt(join(broken, "gone"))]).then((results) => {
      expect(results.map((result) => Result.isFailure(result) && result.failure._tag)).toEqual([
        "WebBuildError",
        "WebBuildError",
        "WebBuildError",
      ])
    })
  })

  test("is made by a process of its own, which says what went wrong when it cannot", () =>
    Promise.all([bundle(join(import.meta.dir, "..", "web")), bundle(join(tmpdir(), "estate-nowhere"))]).then(
      ([made, failed]) => {
        expect(made.ok && made.outputs.map((output) => output.name.replace(/-[^-]+\./, ".")).toSorted()).toEqual([
          "instrument-sans-latin.woff2",
          "jetbrains-mono-latin.woff2",
          "main.css",
          "main.js",
        ])
        expect(failed.ok).toBe(false)
      },
    ))

  test(
    "serves the fonts the pages are drawn in itself, byte for byte, and names no other host for them",
    () =>
      Effect.runPromise(
        read.pipe(
          Effect.flatMap((web) =>
            Effect.gen(function* () {
              expect(web.index).not.toMatch(/fonts\.(googleapis|gstatic)\.com/)
              // Each font is preloaded by the shell, from Estate's own /assets/.
              const fonts = [...web.index.matchAll(/rel="preload" href="\/assets\/([^"]+\.woff2)"/g)].map(
                ([, name]) => name ?? "",
              )
              const unhashed = (name: string) => name.replace(/-[^-]+\.woff2$/, "")
              expect(fonts.map(unhashed)).toEqual(["instrument-sans-latin", "jetbrains-mono-latin"])
              for (const name of fonts) {
                const served = Option.getOrThrow(web.asset(name))
                const kept = yield* Effect.promise(() =>
                  Bun.file(join(import.meta.dir, "..", "web", "fonts", `${unhashed(name)}.woff2`)).bytes(),
                )
                expect([served.type, served.body]).toEqual(["font/woff2", kept])
              }
            }),
          ),
          Effect.provide(Layer.fresh(builtWeb).pipe(Layer.provide(platform))),
        ),
      ),
    30_000,
  )

  test("is printed as JSON for Estate to read", () => {
    const to = Bun.file(join(mkdtempSync(join(tmpdir(), "estate-bundle-")), "printed.json"))
    return print(join(tmpdir(), "estate-nowhere"), to)
      .then(() => to.json())
      .then((printed) => expect(printed).toMatchObject({ ok: false }))
  })

  test("is printed as JSON, which the image keeps and Estate serves without bundling again", () => {
    const kept = join(mkdtempSync(join(tmpdir(), "estate-bundle-")), "pages.json")
    return print(join(import.meta.dir, "..", "web"), Bun.file(kept)).then(() =>
      Effect.runPromise(
        read.pipe(
          Effect.flatMap((web) =>
            Effect.sync(() => {
              const script = /src="\/assets\/([^"]+\.js)"/.exec(web.index)?.[1] ?? ""
              expect(Option.isSome(web.asset(script))).toBe(true)
            }),
          ),
          Effect.provide(buildWeb(join(import.meta.dir, "..", "web"), kept).pipe(Layer.provide(platform))),
        ),
      ),
    )
  }, 30_000)
})
