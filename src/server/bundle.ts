/**
 * The pages bundled in a process of their own. Solid's compiler runs on Babel, which would stay in Estate's memory
 * for its whole life if loaded there; a process that bundles, prints and exits keeps it out.
 */
import { join } from "node:path"

interface Bundled {
  readonly name: string
  readonly type: string
  readonly text: string
}

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
        plugins: [solidPlugin],
        define: { "process.env.NODE_ENV": '"production"' },
      }),
    )
    .then((built): Promise<Bundle> | Bundle =>
      built.success
        ? Promise.all(
            built.outputs.map((output) =>
              output.text().then((text) => ({ name: output.path.replace(/^.*\//, ""), type: output.type, text })),
            ),
          ).then((outputs) => ({ ok: true, outputs }))
        : { ok: false, message: built.logs.map(String).join("\n") },
    )
    .catch((error: unknown) => ({ ok: false, message: String(error) }))

/** The bundle as JSON, to the file `to`, which the image keeps and Estate reads. A pipe is not used: large writes to one stall. */
export const print = (directory: string, to: Bun.BunFile): Promise<number> =>
  bundle(directory).then((result) => Bun.write(to, JSON.stringify(result)))

if (import.meta.main) void print(Bun.argv[2] ?? "", Bun.file(Bun.argv[3] ?? "pages.json"))
