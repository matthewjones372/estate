/** @jsxImportSource solid-js */
/** A service's jobs: each one's schedule, its last runs and how they ended, and when it runs next. */
import { For, Show } from "solid-js"
import type { Job } from "../../shared/events"
import { useEstate } from "../context"
import { clock, duration, since } from "../format"

const outcomeWords = { running: "running", succeeded: "succeeded", failed: "failed" } as const

export const Run = (props: { readonly run: Job["runs"][number]; readonly now: number }) => {
  const took = () =>
    props.run.finishedAt === undefined
      ? `for ${since(props.run.startedAt, props.now)}`
      : `in ${duration(Date.parse(props.run.finishedAt) - Date.parse(props.run.startedAt))}`
  const tone = () =>
    props.run.outcome === "failed" ? "attention" : props.run.outcome === "running" ? "active" : "quiet"
  return (
    <li class="job-run">
      <span
        class={`dot ${props.run.outcome === "failed" ? "attention" : props.run.outcome === "running" ? "unknown live" : "healthy"}`}
      />
      <span class="mono">{clock(props.run.startedAt)}</span>
      <span class={`rail-note ${tone()}`}>
        {outcomeWords[props.run.outcome]} {took()}
        {props.run.message === undefined ? "" : `: ${props.run.message}`}
      </span>
    </li>
  )
}

export const Jobs = (props: { readonly jobs: ReadonlyArray<Job> }) => {
  const { now } = useEstate()
  return (
    <Show
      when={props.jobs.length > 0}
      fallback={
        <p class="muted" style={{ margin: 0 }}>
          No jobs are named for it.
        </p>
      }
    >
      <div class="pods">
        <For each={props.jobs}>
          {(job) => (
            <div class="pod job">
              <span class="spread">
                <span class="mono">{job.name}</span>
                <span class="muted" style={{ "font-size": "12px" }}>
                  {job.kind === "CronJob" ? (
                    <span class="mono">{job.schedule}</span>
                  ) : job.kind === "ScheduledTask" ? (
                    "Scheduled task"
                  ) : (
                    "Job"
                  )}
                </span>
              </span>
              {job.suspended && <span class="muted">suspended</span>}
              <Show when={job.absent}>{(absent) => <span class="rail-note attention">{absent()}</span>}</Show>
              <Show when={job.missed}>
                {(missed) => <span class="rail-note attention">missed its run at {clock(missed())}</span>}
              </Show>
              <Show when={job.next}>
                {(next) => (
                  <span class="muted" style={{ "font-size": "12px" }}>
                    next at {clock(next())}
                  </span>
                )}
              </Show>
              <ol class="job-runs">
                {job.runs.length === 0 && job.absent === undefined && <li class="muted">no runs kept</li>}
                <For each={job.runs}>{(run) => <Run run={run} now={now()} />}</For>
              </ol>
            </div>
          )}
        </For>
      </div>
    </Show>
  )
}
