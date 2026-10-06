/** @jsxImportSource solid-js */
/**
 * A service's code health under its cost (spec 0034): its gate, coverage and open alerts, quiet unless its owner
 * should look, each part a link to the tool that says it.
 */
import { For, Show } from "solid-js"
import { alertsSaid, type CodeHealth, codeLine, needsLook } from "../../shared/code"

/** Each tool's part of the line, with where it leads. */
const parts = (health: CodeHealth): ReadonlyArray<{ readonly text: string; readonly href: string }> => {
  const sonar = health.sonarqube
  const alerts = [health.dependabot, health.scanning].filter((each) => each !== undefined)
  const worst = alerts.find((each) => alertsSaid(each.alerts) !== undefined) ?? alerts[0]
  const total = {
    critical: alerts.reduce((sum, each) => sum + each.alerts.critical, 0),
    high: alerts.reduce((sum, each) => sum + each.alerts.high, 0),
    medium: alerts.reduce((sum, each) => sum + each.alerts.medium, 0),
    low: alerts.reduce((sum, each) => sum + each.alerts.low, 0),
  }
  return [
    ...(sonar === undefined || (sonar.gate === "none" && sonar.coverage === undefined)
      ? []
      : [{ text: codeLine({ sonarqube: sonar }), href: sonar.href }]),
    ...(worst === undefined ? [] : [{ text: alertsSaid(total) ?? "no open alerts", href: worst.href }]),
  ]
}

export const CodeLine = (props: { readonly code: CodeHealth | undefined }) => (
  <Show when={props.code !== undefined && codeLine(props.code) !== "" ? props.code : undefined}>
    {(health) => (
      <span class={`muted code-line${needsLook(health()) ? " needs-look" : ""}`}>
        code:{" "}
        <For each={parts(health())}>
          {(part, index) => (
            <>
              {index() > 0 ? " · " : ""}
              <a href={part.href} target="_blank" rel="noreferrer">
                {part.text}
              </a>
            </>
          )}
        </For>
      </span>
    )}
  </Show>
)
