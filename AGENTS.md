# Working in this repo

Estate is TypeScript on Bun, server and pages, for any estate, not one. The server and the shared schemas are
[Effect](https://effect.website). Spec 0001 says how it is built.

- **Specs come first.** Nothing is built without a committed spec in `specs/`; see `specs/README.md`.
- **Nothing in it knows one estate.** Services, environments, queries, links and groups come from the catalog and the
  configuration. A name from lark-bank in the code, outside tests and examples, is a bug.
- **Read, don't store.** What another tool keeps is read from it and linked to; Estate keeps only its own notes and
  who switched what.
- **A source is an interface and a test.** Each kind (Prometheus, Alertmanager, Kubernetes, Flux, GitHub) is one
  implementation, tested against a stub of its API; a missing or silent source turns its parts off, never the page.
- **The catalog is checked at start.** Every mistake is named, and Estate does not start with one.
- **Errors are in the type.** A failure a caller can meet is a `Data.TaggedError` in the Effect's error channel,
  handled with `catchTag`; no `throw`, `try` or `async` in `server` or `shared`. Dependencies are services
  (`Context.Service`) provided by layers, and a test provides the stub layer. Data from outside is decoded with `Schema`.
  A `switch` over a union is exhaustive, with no `default`; `Match.exhaustive` where it reads better.
- **Run an Effect once, at the edge.** `runMain` in the server's entry, `Effect.runPromise` in a test; nowhere else.
- **Comments say why, in a line or two.** No restating the code, and no history.
- **Docs say what is, not how it got here.** No history, measurements are the latest only; diagrams are mermaid.
- **Tests are sentences**, `test("a broken catalog names every mistake", …)`, with `bun test`. The failing test comes
  first.
- **The gate is the definition of done:** `bun run gate`, and quote the result. Its configuration is a person's to
  change, never an agent's.
