/** @jsxImportSource solid-js */
/** Deploys: every service across every environment, then each one's pipeline in the chosen environment. */
import { For } from "solid-js"
import type { DeploysEvent } from "../../shared/events"
import { useEstate, useSnapshot } from "../context"
import { clock, counted, since } from "../format"
import { A, Out } from "../parts/A"
import { pipelineOf } from "../parts/Rail"

type Row = DeploysEvent["services"][number]

export const summaryOf = (deploys: DeploysEvent | undefined): { readonly title: string; readonly detail: string } => {
  const services = deploys?.services ?? []
  const stalled = services.filter((service) => service.environments.some((each) => each.stalled !== undefined))
  const building = services.filter(
    (service) => service.builds[0]?.status === "running" || service.builds[0]?.status === "queued",
  )
  const failed = services.filter((service) => service.builds[0]?.status === "failure")
  const stuck = stalled.length + failed.length
  const title =
    stuck === 0 ? "Every deploy is in step." : `${counted(stuck, "deploy")} ${stuck === 1 ? "is" : "are"} stuck.`
  const parts = [
    ...stalled.map(
      (service) =>
        `${service.name} stalled: ${service.environments.find((each) => each.stalled !== undefined)?.stalled ?? ""}`,
    ),
    ...failed.map((service) => `${service.name}'s last build failed`),
    ...(building.length === 0
      ? []
      : [`${building.map((service) => service.name).join(", ")} ${building.length === 1 ? "is" : "are"} building`]),
  ]
  return { title, detail: parts.length === 0 ? "Each environment runs what it chose." : `${parts.join(". ")}.` }
}

/** A leaf with no state of its own: drawn again, whole, when what it reads changes. */
const cell = (props: { readonly row: Row; readonly environment: string }) => {
  const deployed = props.row.environments.find((each) => each.environment === props.environment)
  if (deployed === undefined) return <td class="muted">not here</td>
  if (!deployed.seen) return <td class="muted">not read here</td>
  const tone = deployed.stalled !== undefined ? "attention" : deployed.running === undefined ? "unknown" : "healthy"
  const note =
    deployed.stalled ??
    (deployed.chosen !== undefined &&
    deployed.running !== undefined &&
    !deployed.chosen.version.includes(deployed.running)
      ? `moving to ${deployed.chosen.version}`
      : deployed.chosen?.at === undefined
        ? ""
        : `since ${clock(deployed.chosen.at)}`)
  return (
    <td>
      <span class="cell-version mono">
        <span class={`dot ${tone}`} />
        {deployed.running ?? "not running"}
      </span>
      <div class={`cell-note ${deployed.stalled === undefined ? "" : "attention"}`}>{note}</div>
    </td>
  )
}

const stepWords = { done: "done", active: "in progress", stalled: "stalled", waiting: "waiting" } as const

const pipelineRow = (props: { readonly row: Row; readonly environment: string; readonly now: number }) => {
  const row = props.row
  const deployed = row.environments.find((each) => each.environment === props.environment)
  const pipeline = pipelineOf(row.builds, deployed, props.now)
  const build = row.builds[0]
  const values = [
    { value: build?.sha.slice(0, 7) ?? "–", detail: build?.title ?? "no commit seen", href: build?.url },
    {
      value: build === undefined ? "–" : build.status,
      detail: build === undefined ? "" : since(build.at, props.now),
      href: build?.url,
    },
    {
      value: deployed?.chosen?.version ?? "–",
      detail: deployed?.stalled ?? (deployed?.chosen?.at === undefined ? "" : clock(deployed.chosen.at)),
      href: undefined,
    },
    {
      value: deployed?.running ?? "–",
      detail: deployed === undefined ? "not in this environment" : "",
      href: undefined,
    },
  ]
  return (
    <article class="pipeline">
      <div class="pipeline-name">
        <A to={`/services/${encodeURIComponent(row.name)}`} class="lane-title">
          {row.name}
        </A>
        <span class={`rail-note ${pipeline.tone}`}>{pipeline.note}</span>
      </div>
      {pipeline.steps.map((step, index) => {
        const value = values[index]
        return (
          <div class={`step ${step}`}>
            <span class="step-state">{stepWords[step]}</span>
            {value?.href === undefined ? (
              <span class="mono">{value?.value}</span>
            ) : (
              <Out href={value.href} class="mono">
                {value.value}
              </Out>
            )}
            <span class="muted step-detail">{value?.detail}</span>
          </div>
        )
      })}
    </article>
  )
}

export const Deploys = () => {
  const { now } = useEstate()
  const snapshot = useSnapshot()
  const deploys = () => snapshot.events.deploys
  const summary = () => summaryOf(deploys())
  const environments = () => deploys()?.environments ?? []
  const here = () =>
    (deploys()?.services ?? []).filter((row) =>
      row.environments.some((each) => each.environment === snapshot.environment),
    )
  return (
    <main class="main">
      <section aria-label="Summary" class="stack">
        <h1 class="headline" style={{ "font-size": "38px" }}>
          {summary().title}
        </h1>
        <p class="lede" style={{ "max-width": "720px" }}>
          {summary().detail}
        </p>
      </section>
      <section aria-labelledby="across" class="stack">
        <div class="spread">
          <h2 id="across" class="section-title">
            Across environments
          </h2>
          <span class="muted" style={{ "font-size": "12px" }}>
            What runs in each, and what is waiting to move on
          </span>
        </div>
        <div class="table-scroll panel">
          <table class="grid">
            <thead>
              <tr>
                <th scope="col">Service</th>
                <th scope="col">Last build</th>
                <For each={environments()}>{(name) => <th scope="col">{name}</th>}</For>
              </tr>
            </thead>
            <tbody>
              <For each={deploys()?.services ?? []}>
                {(row) => (
                  <tr>
                    <th scope="row">
                      <A to={`/services/${encodeURIComponent(row.name)}`}>{row.name}</A>
                    </th>
                    <td>
                      <span class="mono">{row.builds[0]?.sha.slice(0, 7) ?? "–"}</span>
                      <div class="cell-note">
                        {row.builds[0] === undefined
                          ? "no builds read"
                          : `${row.builds[0].status}, ${since(row.builds[0].at, now())} ago`}
                      </div>
                    </td>
                    <For each={environments()}>{(name) => cell({ row, environment: name })}</For>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </section>
      <section aria-labelledby="pipelines" class="stack">
        <h2 id="pipelines" class="section-title">
          Pipelines · {snapshot.environment}
        </h2>
        <div class="pipeline-head muted" aria-hidden="true">
          <span />
          <span>Commit on main</span>
          <span>Build</span>
          <span>Chosen</span>
          <span>Running</span>
        </div>
        <For each={here()}>{(row) => pipelineRow({ row, environment: snapshot.environment, now: now() })}</For>
        <p class="muted" style={{ margin: 0, "font-size": "13px" }}>
          A step that stalls says why, in the words the tool used.
        </p>
      </section>
    </main>
  )
}
