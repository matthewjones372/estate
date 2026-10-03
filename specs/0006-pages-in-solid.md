# 0006 — The pages in Solid

## Problem

The page is a live stream, and every event re-renders the React tree under the store: each lane, chart and card is
compared again to change one number. React and its DOM also make up most of what a phone downloads, more than half a
megabyte unminified. [Solid](https://www.solidjs.com) uses the same JSX, but updates only the text, attribute or
node that read a changed value, and its runtime is about 7 KB.

## Not doing

- **Changing what the page looks like or does.** The same pages, parts, CSS, events, routes and tests, written in
  Solid. Anything new waits for the next spec.
- **SolidStart, or rendering on the server.** The server still bundles `src/web` as it starts and serves it from
  memory.
- **Changing the gate's configuration.** `tsconfig.json` stays on `react-jsx`: each page file names its JSX source in
  a `@jsxImportSource solid-js` pragma, and Bun is given Solid's compiler as a plugin. `bunfig.toml`,
  `package.json`'s scripts and `tools/` are unchanged.

## Shape

```tsx
/** @jsxImportSource solid-js */
export const Lane = (props: { readonly service: CatalogService }) => {
  const state = () => useServices()?.find((each) => each.name === props.service.name)
  return <article class={`lane ${state()?.health ?? "unknown"}`}>…</article>
}
```

- **The store** keeps its port: `createLive(open, environment)` with `subscribe` and `snapshot`. `useSnapshot()`
  becomes an accessor fed by `from(live.subscribe)`, so a part that reads `snapshot().events.alerts` updates when the
  alerts do, and only then.
- **Parts** read props through `props.x`, never destructured, so that they stay reactive. Lists use `<For>`,
  conditions `<Show>`, and local state `createSignal`.
- **Compiling**: `src/shared/solid.ts` is a Bun plugin that runs `babel-preset-solid` over `src/web/**/*.tsx`. The
  server's `Bun.build` uses it. Tests register it with `Bun.plugin` before importing a page, and resolve Solid to its
  browser build, since `bun test` would pick its server build.
- **Tests** keep happy-dom and the same sentences. They render with `solid-js/web`'s `render`, and a harness `.tsx`
  holds the JSX the test files need, because a test file is loaded before the plugin is registered.

## Why this shape

Solid was chosen over Preact and Svelte. Preact would shrink the bundle but keep re-rendering everything on each
event. Svelte would mean rewriting every page in its own syntax. Solid keeps the JSX, so each file changes line by
line, and a stream of small changes is exactly what its fine-grained updates are for. Compiling through Babel in a
Bun plugin, rather than a separate Vite build, keeps "the server bundles the pages as it starts".

## Depends on

Nothing.

## Stack

- [ ] **`solid`** — the compiler plugin, the store, every part and page, and the tests, in Solid; React removed.
      One entry rather than several, since React's and Solid's JSX cannot share the type checker's setting.
      Done when: `bun run gate` and `bunx playwright test` pass unchanged in what they check, and the page's script is
      under 150 KB minified.

## Acceptance

```bash
bun run gate
bunx playwright test
```

## Open questions

1. **A lint rule against destructured props?** Recommended later: Biome has no Solid rules yet, and the tests catch a
   part that stops updating.
