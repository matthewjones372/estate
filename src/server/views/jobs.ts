/** Jobs no service owns: each one's health from its last runs and the alerts about it. */
import type { StandaloneJob } from "../../shared/catalog"
import type { Health, Job } from "../../shared/events"
import type { EnvironmentState } from "../state"

/** What a job's runs and alerts say of it: a failed, missed or missing job needs someone. */
export const jobHealthOf = (
  job: StandaloneJob,
  environment: EnvironmentState,
): { readonly health: Health; readonly reasons: ReadonlyArray<string>; readonly job?: Job } => {
  const read = environment.cluster.value?.jobs?.[job.name]?.[0]
  const firing = (environment.alerts.value ?? []).filter(
    (alert) => alert.state === "firing" && alert.labels["service"] === job.name,
  )
  const critical = firing.filter((alert) => alert.severity === "critical").map((alert) => `${alert.name} is firing`)
  const attention = firing.filter((alert) => alert.severity !== "critical").map((alert) => `${alert.name} is firing`)
  const last = read?.runs.find((run) => run.outcome !== "running")
  if (last?.outcome === "failed")
    attention.push(`its last run failed${last.message === undefined ? "" : `: ${last.message}`}`)
  if (read?.missed !== undefined) attention.push("it missed a run")
  if (read?.absent !== undefined) attention.push(read.absent)
  const withJob = read === undefined ? {} : { job: read }
  if (critical.length > 0) return { health: "critical", reasons: [...critical, ...attention], ...withJob }
  if (attention.length > 0) return { health: "attention", reasons: attention, ...withJob }
  return read === undefined
    ? { health: "unknown", reasons: ["not read yet"] }
    : { health: "healthy", reasons: [], ...withJob }
}
