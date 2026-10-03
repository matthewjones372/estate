/**
 * The pages: `src/web` bundled when the image is built, or as Estate starts when it runs from source, by a process of
 * its own (`bundle.ts`); served from memory.
 */
import { Context, Data, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { constant, constFalse } from "effect/Function"
import { bundler } from "./bundle"

export interface Asset {
  readonly body: Uint8Array
  readonly type: string
}

export interface Web {
  readonly index: string
  readonly asset: (name: string) => Option.Option<Asset>
}
export const Web = Context.Service<Web>("estate/Web")

const WebBuildError = Data.TaggedError("WebBuildError")<{ readonly message: string }>

const Output = Schema.Struct({ name: Schema.String, type: Schema.String, text: Schema.String })
const Printed = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), outputs: Schema.Array(Output) }),
  Schema.Struct({ ok: Schema.Literal(false), message: Schema.String }),
])
const decodeBundle = Schema.decodeUnknownEffect(Schema.fromJsonString(Printed))

// Bun itself runs the bundler, so starting it cannot fail short of Bun being gone; what it writes is checked. A
// bundler that died before writing leaves no file, which reads as nothing printed.
const bundleNow = (directory: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const to = path.join(yield* fs.makeTempDirectoryScoped(), "pages.json")
    yield* Effect.promise(
      () => Bun.spawn([process.execPath, bundler, directory, to], { stdout: "inherit", stderr: "inherit" }).exited,
    )
    return yield* fs.readFileString(to).pipe(Effect.orElseSucceed(constant("")))
  })

/**
 * The pages from `directory` (`src/web` unless a test names another): as the image bundled them into `prebuilt`
 * (`dist/pages.json`), or, run from source, bundled now; its `index.html` naming the bundle.
 */
export const buildWeb = (directory?: string, prebuilt?: string) =>
  Layer.effect(Web)(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const pages = directory ?? path.join(import.meta.dir, "..", "web")
      const kept = prebuilt ?? path.join(import.meta.dir, "..", "..", "dist", "pages.json")
      const printed = (yield* fs.exists(kept).pipe(Effect.orElseSucceed(constFalse)))
        ? yield* fs.readFileString(kept).pipe(Effect.orElseSucceed(constant("")))
        : yield* bundleNow(pages)
      const built = yield* decodeBundle(printed).pipe(
        Effect.mapError(
          () => new WebBuildError({ message: `the bundler printed no bundle: ${printed.slice(0, 200)}` }),
        ),
      )
      if (!built.ok) return yield* new WebBuildError({ message: built.message })
      const encoder = new TextEncoder()
      const assets = new Map<string, Asset>(
        built.outputs.map((output) => [output.name, { body: encoder.encode(output.text), type: output.type }]),
      )
      const template = yield* fs
        .readFileString(path.join(pages, "index.html"))
        .pipe(Effect.mapError(() => new WebBuildError({ message: `${pages} has no index.html` })))
      const tags = [...assets.keys()]
        .map((name) =>
          name.endsWith(".css")
            ? `<link rel="stylesheet" href="/assets/${name}">`
            : name.endsWith(".js")
              ? `<script type="module" src="/assets/${name}"></script>`
              : "",
        )
        .join("\n    ")
      return {
        index: template.replace("<!-- assets -->", tags),
        asset: (name: string) => Option.fromNullishOr(assets.get(name)),
      }
    }),
  )

export const builtWeb = buildWeb()

export const stubWeb = (index: string, assets: Readonly<Record<string, Asset>> = {}) =>
  Layer.succeed(Web)({ index, asset: (name) => Option.fromNullishOr(assets[name]) })
