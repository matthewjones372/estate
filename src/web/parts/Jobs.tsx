/** A service's jobs: each one's schedule, its last runs and how they ended, and when it runs next. */
import type { Job } from "../../shared/events"
import { useEstate } from "../context"
import { clock, duration, since } from "../format"

const outcomeWords = { running: "running", succeeded: "succeeded", failed: "failed" } as const

const Run = (props: { readonly run: Job["runs"][number]; readonly now: number }) => {
  const { run } = props
  const took =
    run.finishedAt === undefined
      ? `for ${since(run.startedAt, props.now)}`
      : `in ${duration(Date.parse(run.finishedAt) - Date.parse(run.startedAt))}`
  const tone = run.outcome === "failed" ? "attention" : run.outcome === "running" ? "active" : "quiet"
  return (
    <li className="job-run">
      <span
        className={`dot ${run.outcome === "failed" ? "attention" : run.outcome === "running" ? "unknown live" : "healthy"}`}
      />
      <span className="mono">{clock(run.startedAt)}</span>
      <span className={`rail-note ${tone}`}>
        {outcomeWords[run.outcome]} {took}
        {run.message === undefined ? "" : `: ${run.message}`}
      </span>
    </li>
  )
}

export const Jobs = (props: { readonly jobs: ReadonlyArray<Job> }) => {
  const { now } = useEstate()
  if (props.jobs.length === 0)
    return (
      <p className="muted" style={{ margin: 0 }}>
        No jobs are named for it.
      </p>
    )
  return (
    <div className="pods">
      {props.jobs.map((job) => (
        <div key={job.name} className="pod job">
          <span className="spread">
            <span className="mono">{job.name}</span>
            <span className="muted" style={{ fontSize: 12 }}>
              {job.kind === "CronJob" ? <span className="mono">{job.schedule}</span> : "Job"}
            </span>
          </span>
          {job.suspended && <span className="muted">suspended</span>}
          {job.missed !== undefined && (
            <span className="rail-note attention">missed its run at {clock(job.missed)}</span>
          )}
          {job.next !== undefined && (
            <span className="muted" style={{ fontSize: 12 }}>
              next at {clock(job.next)}
            </span>
          )}
          <ol className="job-runs">
            {job.runs.length === 0 && <li className="muted">no runs kept</li>}
            {job.runs.map((run) => (
              <Run key={run.name} run={run} now={now()} />
            ))}
          </ol>
        </div>
      ))}
    </div>
  )
}
