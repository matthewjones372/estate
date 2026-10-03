/**
 * Solid's compiler as a Bun plugin: the pages' `.tsx` are compiled by `babel-preset-solid`, since Bun's own JSX
 * transform is React's. The server's bundle uses it, and so do the pages' tests.
 */
import { transformAsync } from "@babel/core"
import typescript from "@babel/preset-typescript"
import solid from "babel-preset-solid"
import type { BunPlugin } from "bun"

const compile = (path: string, source: string): Promise<string> =>
  transformAsync(source, {
    filename: path,
    presets: [
      [solid, { generate: "dom" }],
      [typescript, { onlyRemoveTypeImports: true }],
    ],
    sourceMaps: "inline",
    configFile: false,
    babelrc: false,
  }).then((result) => result?.code ?? "")

const pages = /src\/web\/.*\.tsx$/

export const solidPlugin: BunPlugin = {
  name: "solid",
  setup: (build) => {
    build.onLoad({ filter: pages }, ({ path }) =>
      Bun.file(path)
        .text()
        .then((source) => compile(path, source))
        .then((contents) => ({ contents, loader: "js" as const })),
    )
  },
}

/**
 * For `bun test`, which resolves Solid to its server build: every import of Solid, in the pages and in Solid itself,
 * is pointed at the browser build instead, so the pages and their tests share one Solid.
 */
const solidRoot = `${process.cwd()}/node_modules/solid-js`
const builds: ReadonlyArray<readonly [RegExp, string]> = [
  [/from\s*["']solid-js["']/g, `from "${solidRoot}/dist/solid.js"`],
  [/from\s*["']solid-js\/web["']/g, `from "${solidRoot}/web/dist/web.js"`],
  [/from\s*["']solid-js\/store["']/g, `from "${solidRoot}/store/dist/store.js"`],
]
const toBrowser = (code: string): string =>
  builds.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), code)

export const solidInBrowser = {
  web: `${solidRoot}/web/dist/web.js`,
  plugin: {
    name: "solid-in-browser",
    setup: (build) => {
      build.onLoad({ filter: pages }, ({ path }) =>
        Bun.file(path)
          .text()
          .then((source) => compile(path, source))
          .then((contents) => ({ contents: toBrowser(contents), loader: "js" as const })),
      )
      build.onLoad({ filter: /src\/web\/.*[^x]\.ts$/ }, ({ path }) =>
        Bun.file(path)
          .text()
          .then((contents) => ({ contents: toBrowser(contents), loader: "ts" as const })),
      )
      build.onLoad({ filter: /node_modules\/solid-js\/(web|store)\/dist\/(web|store)\.js$/ }, ({ path }) =>
        Bun.file(path)
          .text()
          .then((contents) => ({ contents: toBrowser(contents), loader: "js" as const })),
      )
    },
  } satisfies BunPlugin,
}
