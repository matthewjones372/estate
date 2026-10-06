/**
 * A service's code health (spec 0034): its last analysis's quality gate, coverage and issues from SonarQube, and its
 * open Dependabot and code scanning alerts from GitHub; each with a link to the tool that says it.
 */
import { Schema } from "effect"

const optional = Schema.optionalKey

const Severities = Schema.Struct({
  critical: Schema.Number,
  high: Schema.Number,
  medium: Schema.Number,
  low: Schema.Number,
})
export type Severities = typeof Severities.Type

export const CodeHealth = Schema.Struct({
  sonarqube: optional(
    Schema.Struct({
      gate: Schema.Literals(["passed", "failed", "none"]),
      coverage: optional(Schema.Number),
      bugs: optional(Schema.Number),
      vulnerabilities: optional(Schema.Number),
      smells: optional(Schema.Number),
      href: Schema.String,
    }),
  ),
  dependabot: optional(Schema.Struct({ alerts: Severities, href: Schema.String })),
  scanning: optional(Schema.Struct({ alerts: Severities, href: Schema.String })),
})
export type CodeHealth = typeof CodeHealth.Type

export const none: Severities = { critical: 0, high: 0, medium: 0, low: 0 }

const order = ["critical", "high", "medium", "low"] as const

/** Alerts as a person reads them, worst first: "2 critical, 1 high alerts"; nothing when there are none. */
export const alertsSaid = (alerts: Severities): string | undefined => {
  const counted = order.filter((severity) => alerts[severity] > 0)
  if (counted.length === 0) return undefined
  const total = counted.reduce((sum, severity) => sum + alerts[severity], 0)
  return `${counted.map((severity) => `${alerts[severity]} ${severity}`).join(", ")} alert${total === 1 ? "" : "s"}`
}

const together = (health: CodeHealth): Severities => {
  const a = health.dependabot?.alerts ?? none
  const b = health.scanning?.alerts ?? none
  return { critical: a.critical + b.critical, high: a.high + b.high, medium: a.medium + b.medium, low: a.low + b.low }
}

/** The line under a service: its gate, coverage and open alerts, as far as its tools said. */
export const codeLine = (health: CodeHealth | undefined): string => {
  if (health === undefined) return ""
  const sonar = health.sonarqube
  return [
    ...(sonar === undefined || sonar.gate === "none" ? [] : [`gate ${sonar.gate}`]),
    ...(sonar?.coverage === undefined ? [] : [`${Math.round(sonar.coverage)}% covered`]),
    ...(health.dependabot === undefined && health.scanning === undefined
      ? []
      : [alertsSaid(together(health)) ?? "no open alerts"]),
  ].join(" · ")
}

/** Whether the service's owner should look: its gate failed, or a critical or high alert is open. */
export const needsLook = (health: CodeHealth | undefined): boolean => {
  if (health === undefined) return false
  const alerts = together(health)
  return health.sonarqube?.gate === "failed" || alerts.critical > 0 || alerts.high > 0
}
