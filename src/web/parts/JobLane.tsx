/** @jsxImportSource solid-js */
/** A lane for a job no service owns: its health and why, what runs it, its last runs, when it runs next, its links. */
import { For, Show } from "solid-js"
import type { CatalogEvent, ServicesEvent } from "../../shared/events"
import { useEstate } from "../context"
import { clock } from "../format"
import { Run } from "./Jobs"
import { HealthLine, Links } from "./Lane"

export type DescribedJob = NonNullable<CatalogEvent["jobs"]>[number]
export type JobState = NonNullable<ServicesEvent["jobs"]>[number]

const kindWords = { CronJob: "CronJob", Job: "Job", ScheduledTask: "Scheduled task" } as const

export const JobLane = (props: { readonly job: DescribedJob; readonly state: JobState | undefined }) => {
  const { now } = useEstate()
  const read = () => props.state?.job
  return (
    <article class={`lane job-lane ${props.state?.health ?? "unknown"}`} aria-label={`${props.job.name}, a job`}>
      <div class="lane-name">
        <span class="lane-title">{props.job.name}</span>
        <HealthLine state={props.state} />
        <span class="muted mono" style={{ "font-size": "12px" }}>
          {read()?.schedule ?? kindWords[props.job.kind]}
          <Show when={read()?.next}>{(next) => ` · next at ${clock(next())}`}</Show>
        </span>
      </div>
      <ol class="job-runs">
        <Show when={read() !== undefined && read()?.runs.length === 0 && read()?.absent === undefined}>
          <li class="muted">no runs kept</li>
        </Show>
        <For each={(read()?.runs ?? []).slice(0, 3)}>{(run) => <Run run={run} now={now()} />}</For>
      </ol>
      <Links service={props.job} />
    </article>
  )
}
