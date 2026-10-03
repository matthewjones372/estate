/** @jsxImportSource solid-js */
/**
 * An AI agent's lane: its health and why, the model it uses and since when, its runs, failures, slowest runs and
 * tokens over the last hour, its tokens against its budget, and its links and team.
 */
import { createSignal, For, Show } from "solid-js"
import type { AgentRun } from "../../shared/agents"
import { type AgentState, tokens } from "../../shared/agents"
import type { CatalogEvent, Series } from "../../shared/events"
import { useEstate, useSnapshot } from "../context"
import { clock, duration } from "../format"
import { teamOf } from "../teams"
import { Out } from "./A"
import { HealthLine, Links } from "./Lane"
import { Spark } from "./Sparkline"
import { Owner } from "./Team"

export type DescribedAgent = NonNullable<CatalogEvent["agents"]>[number]

const periods = { day: "today", month: "this month" } as const

type Points = Series | undefined

/** A series in other units: runs a second as runs a minute, tokens an hour in thousands. */
export const scaled = (series: Points, by: number): Points =>
  series && {
    now: series.now === null ? null : series.now * by,
    points: series.points.map((point) => (point === null ? null : point * by)),
  }

/** One series as a share of another, point by point, in percent: failing runs of all runs. */
export const shareOf = (part: Points, whole: Points): Points => {
  if (part === undefined || whole === undefined) return undefined
  const share = (a: number | null, b: number | null | undefined) =>
    a === null || b === null || b === undefined || b === 0 ? null : (a / b) * 100
  return {
    now: share(part.now, whole.now),
    points: part.points.map((point, index) => share(point, whole.points[index])),
  }
}

/** "$0.041", "$1.20": a run's cost, small as it usually is. */
const dollars = (cost: number) => `$${cost < 1 ? cost.toFixed(3) : cost.toFixed(2)}`

/** The agent's recent runs, read when opened: each one's outcome, how long, tokens, cost and model, and its trace. */
const Runs = (props: { readonly agent: string }) => {
  const { actions } = useEstate()
  const [runs, setRuns] = createSignal<ReadonlyArray<AgentRun> | "closed" | "reading" | "none" | "failed">("closed")
  const open = () => {
    setRuns("reading")
    void actions.runs(props.agent).then((read) => setRuns(read ?? "failed"))
  }
  return (
    <div class="agent-runs">
      <Show
        when={runs() !== "closed" && runs() !== "reading"}
        fallback={
          <button type="button" class="plain-button" onClick={open} disabled={runs() === "reading"}>
            {runs() === "reading" ? "Reading runs…" : "Recent runs"}
          </button>
        }
      >
        <Show
          when={Array.isArray(runs())}
          fallback={<p class="muted">{runs() === "none" ? "No runs to read here." : "The runs could not be read."}</p>}
        >
          <ol class="job-runs" aria-label={`Recent runs of ${props.agent}`}>
            <For each={runs() as ReadonlyArray<AgentRun>}>
              {(run) => (
                <li class="job-run">
                  <span class={`dot ${run.failed ? "attention" : "healthy"}`} />
                  <span class="mono">{clock(run.startedAt)}</span>
                  <span class={`rail-note ${run.failed ? "attention" : "quiet"}`}>
                    {run.failed ? "failed" : "done"}
                    {run.seconds === undefined
                      ? ""
                      : ` in ${run.seconds < 60 ? `${Math.round(run.seconds)} s` : duration(run.seconds * 1000)}`}
                    {run.message === undefined ? "" : `: ${run.message}`}
                  </span>
                  <span class="muted mono">
                    {[
                      run.tokens === undefined ? undefined : `${tokens(run.tokens)} tokens`,
                      run.cost === undefined ? undefined : dollars(run.cost),
                      run.model,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <Show when={run.url}>
                    {(url) => (
                      <Out href={url()} class="plain-button">
                        Trace
                      </Out>
                    )}
                  </Show>
                </li>
              )}
            </For>
          </ol>
        </Show>
      </Show>
    </div>
  )
}

export const AgentLane = (props: { readonly agent: DescribedAgent; readonly state: AgentState | undefined }) => {
  const snapshot = useSnapshot()
  const usage = () => props.state?.usage
  const pods = () => props.state?.pods ?? []
  return (
    <article class={`lane agent-lane ${props.state?.health ?? "unknown"}`} aria-label={`${props.agent.name}, an agent`}>
      <div class="lane-name">
        <span class="lane-title">{props.agent.name}</span>
        <HealthLine state={props.state && { ...props.state, pods: [] }} />
        <span class="muted mono" style={{ "font-size": "12px" }}>
          {usage()?.model ?? "model not read"}
          <Show when={usage()?.modelSince}>{(since) => ` · since ${clock(since())}`}</Show>
          <Show when={pods().length > 0}>{` · ${pods().filter((pod) => pod.ready).length}/${pods().length} pods`}</Show>
        </span>
        <Show when={props.agent.budget}>
          {(budget) => (
            <span class="mono agent-budget" style={{ "font-size": "12px" }}>
              {usage()?.spent === undefined || usage()?.spent === null
                ? `budget ${tokens(budget().tokens)} tokens a ${budget().per}`
                : `${tokens(usage()?.spent ?? 0)} of ${tokens(budget().tokens)} tokens ${periods[budget().per]}`}
            </span>
          )}
        </Show>
      </div>
      <div class="sparks">
        <Spark label="Runs" unit="/min" series={scaled(usage()?.runs, 60)} />
        <Spark label="Failing" unit="%" series={shareOf(usage()?.errors, usage()?.runs)} />
        <Spark label="p99" unit="s" series={usage()?.p99} />
        <Spark label="Tokens" unit="k/h" series={scaled(usage()?.tokens, 0.001)} />
      </div>
      <Show when={props.agent.runs}>
        <Runs agent={props.agent.name} />
      </Show>
      <Links service={props.agent} />
      <Owner owner={props.agent.owner} team={teamOf(snapshot.events.catalog, props.agent.owner)} />
    </article>
  )
}
