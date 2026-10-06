/** The doctor's `code` line: each service's gate, coverage and alerts as its tools say them, or why they could not. */
import { Effect } from "effect"
import type { Catalog } from "../shared/catalog"
import { codeLine } from "../shared/code"
import type { Finding } from "./doctor-finding"
import type { Code } from "./settings-code"
import { readCode } from "./sources/code"

/** The line, when code health is set up; none otherwise. */
export const codeFinding = (code: Code | undefined, catalog: Catalog) =>
  code === undefined
    ? Effect.succeed(undefined)
    : Effect.map(readCode(code, catalog.services), ({ health, failures }): Finding => {
        const said = Object.entries(health).map(([name, each]) => `${name} ${codeLine(each)}`)
        return {
          part: "code",
          ok: failures.length === 0,
          says: [...failures, ...said].join("; ") || "no service names a SonarQube project or a GitHub repository",
        }
      })
