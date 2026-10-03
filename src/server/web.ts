/** The pages: `src/web` bundled by Bun as Estate starts, and served from memory. */
import { join } from "node:path"
import { Context, Data, Effect, Layer, Option } from "effect"

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

const webDirectory = join(import.meta.dir, "..", "web")

/** The pages from `directory`: its `main.tsx` bundled, its `index.html` naming the bundle. */
export const buildWeb = (directory: string) =>
  Layer.effect(Web)(
    Effect.gen(function* () {
      const built = yield* Effect.tryPromise({
        try: () =>
          Bun.build({
            entrypoints: [join(directory, "main.tsx")],
            minify: true,
            naming: "[name]-[hash].[ext]",
            define: { "process.env.NODE_ENV": '"production"' },
          }),
        catch: (error) => new WebBuildError({ message: String(error) }),
      })
      if (!built.success) return yield* new WebBuildError({ message: built.logs.map(String).join("\n") })
      const assets = new Map<string, Asset>()
      for (const output of built.outputs) {
        const body = new Uint8Array(yield* Effect.promise(() => output.arrayBuffer()))
        assets.set(output.path.replace(/^.*\//, ""), { body, type: output.type })
      }
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
