/** @jsxImportSource solid-js */
/**
 * An AI agent's lane: its health and why, the model it uses and since when, its runs, failures, slowest runs and
 * tokens over the last hour, its tokens against its budget, and its links and team.
 */
import { Show } from "solid-js"
import { type AgentState, tokens } from "../../shared/agents"
import type { CatalogEvent, Series } from "../../shared/events"
import { useSnapshot } from "../context"
import { clock } from "../format"
import { teamOf } from "../teams"
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
      <Links service={props.agent} />
      <Owner owner={props.agent.owner} team={teamOf(snapshot.events.catalog, props.agent.owner)} />
    </article>
  )
}
