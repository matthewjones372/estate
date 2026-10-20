/**
 * The pages bundled in a process of their own. Solid's compiler runs on Babel, which would stay in Estate's memory
 * for its whole life if loaded there; a process that bundles, prints and exits keeps it out.
 */
import { join } from "node:path"

/** An output as JSON can carry it: text as it is, anything else (the fonts) in base64. */
interface Bundled {
  readonly name: string
  readonly type: string
  readonly text?: string
  readonly base64?: string
}

const isText = (type: string) => type.startsWith("text/") || type.startsWith("application/json")

export type Bundle =
  | { readonly ok: true; readonly outputs: ReadonlyArray<Bundled> }
  | { readonly ok: false; readonly message: string }

export const bundler = join(import.meta.dir, "bundle.ts")

export const bundle = (directory: string): Promise<Bundle> =>
  import("../shared/solid")
    .then(({ solidPlugin }) =>
      Bun.build({
        entrypoints: [join(directory, "main.tsx")],
        minify: true,
        naming: "[name]-[hash].[ext]",
        // A font imported by `fonts.ts` is its own file under /assets/, cached for good.
        loader: { ".woff2": "file" },
        publicPath: "/assets/",
        plugins: [solidPlugin],
        define: { "process.env.NODE_ENV": '"production"' },
      }),
    )
    .then((built): Promise<Bundle> | Bundle =>
      built.success
        ? Promise.all(
            built.outputs.map((output) => {
              const name = output.path.replace(/^.*\//, "")
              return isText(output.type)
                ? output.text().then((text) => ({ name, type: output.type, text }))
                : output
                    .arrayBuffer()
                    .then((bytes) => ({ name, type: output.type, base64: new Uint8Array(bytes).toBase64() }))
            }),
          ).then((outputs) => ({ ok: true, outputs }))
        : { ok: false, message: built.logs.map(String).join("\n") },
    )
    .catch((error: unknown) => ({ ok: false, message: String(error) }))

/** The bundle as JSON, to the file `to`, which the image keeps and Estate reads. A pipe is not used: large writes to one stall. */
export const print = (directory: string, to: Bun.BunFile): Promise<number> =>
  bundle(directory).then((result) => Bun.write(to, JSON.stringify(result)))

if (import.meta.main) void print(Bun.argv[2] ?? "", Bun.file(Bun.argv[3] ?? "pages.json"))
