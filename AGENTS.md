# Working in this repo

Estate is built the way orders is, on the library and the framework, and for any estate, not one.

- **Specs come first.** Nothing is built without a committed spec in `specs/`; see `specs/README.md`.
- **Nothing in it knows one estate.** Services, environments, queries, links and groups come from the catalog and the
  configuration. A name from orders in the code, outside tests and examples, is a bug.
- **Read, don't store.** What another tool keeps is read from it and linked to; Estate keeps only its own notes and
  who switched what.
- **A source is an interface and a test.** Each kind (Prometheus, Alertmanager, Kubernetes, Flux, GitHub) is one
  implementation, tested against a stub of its API; a missing or silent source turns its parts off, never the page.
- **The catalog is checked at start.** Every mistake is named, and Estate does not start with one.
- **Errors a caller was promised are values.** `Either` in the ports, and `orFail` on the endpoints. Never
  `runCatching`, and never an `else` on a `when` over a sealed type.
- **Comments say why, in a line or two.** No restating the code, and no history.
- **Docs say what is, not how it got here.** No history, measurements are the latest only; diagrams are mermaid.
- **Tests are sentences in backticks**, Kotest matchers, JUnit 5. The failing test comes first.
- **Verify before saying done:** `./gradlew build`, and quote the result.
