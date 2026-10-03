/**
 * The pages: `src/web` bundled when the image is built, or as Estate starts when it runs from source, by a process of
 * its own (`bundle.ts`); served from memory.
 */
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Context, Data, Effect, Layer, Option, Schema } from "effect"
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

const webDirectory = join(import.meta.dir, "..", "web")

/** Where the image keeps the pages it bundled as it was built. */
const prebuiltPages = join(import.meta.dir, "..", "..", "dist", "pages.json")

// Bun itself runs the bundler, so starting it cannot fail short of Bun being gone; what it writes is checked.
const bundleNow = (directory: string) =>
  Effect.promise(() => {
    const to = Bun.file(join(tmpdir(), `estate-pages-${process.pid}-${Date.now()}.json`))
    // A bundler that died before writing leaves no file, which reads as nothing printed.
    return Bun.spawn([process.execPath, bundler, directory, to.name ?? ""], { stdout: "inherit", stderr: "inherit" })
      .exited.then(() => to.exists())
      .then((written) => (written ? to.text() : ""))
  })

/**
 * The pages from `directory`: as the image bundled them into `prebuilt`, or, run from source, bundled now; its
 * `index.html` naming the bundle.
 */
export const buildWeb = (directory: string, prebuilt = prebuiltPages) =>
  Layer.effect(Web)(
    Effect.gen(function* () {
      const kept = Bun.file(prebuilt)
      const printed = (yield* Effect.promise(() => kept.exists()))
        ? yield* Effect.promise(() => kept.text())
        : yield* bundleNow(directory)
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
      const template = yield* Effect.tryPromise({
        try: () => Bun.file(join(directory, "index.html")).text(),
        catch: () => new WebBuildError({ message: `${directory} has no index.html` }),
      })
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

export const builtWeb = buildWeb(webDirectory)

export const stubWeb = (index: string, assets: Readonly<Record<string, Asset>> = {}) =>
  Layer.succeed(Web)({ index, asset: (name) => Option.fromNullishOr(assets[name]) })
