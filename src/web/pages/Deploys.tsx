/** Deploys: every service across every environment, then each one's pipeline in the chosen environment. */
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

const Cell = (props: { readonly row: Row; readonly environment: string }) => {
  const deployed = props.row.environments.find((each) => each.environment === props.environment)
  if (deployed === undefined) return <td className="muted">not here</td>
  if (!deployed.seen) return <td className="muted">not read here</td>
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
      <span className="cell-version mono">
        <span className={`dot ${tone}`} />
        {deployed.running ?? "not running"}
      </span>
      <div className={`cell-note ${deployed.stalled === undefined ? "" : "attention"}`}>{note}</div>
    </td>
  )
}

const stepWords = { done: "done", active: "in progress", stalled: "stalled", waiting: "waiting" } as const

const PipelineRow = (props: { readonly row: Row; readonly environment: string; readonly now: number }) => {
  const { row } = props
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
    <article className="pipeline">
      <div className="pipeline-name">
        <A to={`/services/${encodeURIComponent(row.name)}`} className="lane-title">
          {row.name}
        </A>
        <span className={`rail-note ${pipeline.tone}`}>{pipeline.note}</span>
      </div>
      {pipeline.steps.map((step, index) => {
        const value = values[index]
        return (
          <div key={["commit", "build", "chosen", "running"][index]} className={`step ${step}`}>
            <span className="step-state">{stepWords[step]}</span>
            {value?.href === undefined ? (
              <span className="mono">{value?.value}</span>
            ) : (
              <Out href={value.href} className="mono">
                {value.value}
              </Out>
            )}
            <span className="muted step-detail">{value?.detail}</span>
          </div>
        )
      })}
    </article>
  )
}

export const Deploys = () => {
  const { now } = useEstate()
  const { events, environment } = useSnapshot()
  const deploys = events.deploys
  const summary = summaryOf(deploys)
  const environments = deploys?.environments ?? []
  return (
    <main className="main">
      <section aria-label="Summary" className="stack">
        <h1 className="headline" style={{ fontSize: 38 }}>
          {summary.title}
        </h1>
        <p className="lede" style={{ maxWidth: 720 }}>
          {summary.detail}
        </p>
      </section>
      <section aria-labelledby="across" className="stack">
        <div className="spread">
          <h2 id="across" className="section-title">
            Across environments
          </h2>
          <span className="muted" style={{ fontSize: 12 }}>
            What runs in each, and what is waiting to move on
          </span>
        </div>
        <div className="table-scroll panel">
          <table className="grid">
            <thead>
              <tr>
                <th scope="col">Service</th>
                <th scope="col">Last build</th>
                {environments.map((name) => (
                  <th key={name} scope="col">
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(deploys?.services ?? []).map((row) => (
                <tr key={row.name}>
                  <th scope="row">
                    <A to={`/services/${encodeURIComponent(row.name)}`}>{row.name}</A>
                  </th>
                  <td>
                    <span className="mono">{row.builds[0]?.sha.slice(0, 7) ?? "–"}</span>
                    <div className="cell-note">
                      {row.builds[0] === undefined
                        ? "no builds read"
                        : `${row.builds[0].status}, ${since(row.builds[0].at, now())} ago`}
                    </div>
                  </td>
                  {environments.map((name) => (
                    <Cell key={name} row={row} environment={name} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section aria-labelledby="pipelines" className="stack">
        <h2 id="pipelines" className="section-title">
          Pipelines · {environment}
        </h2>
        <div className="pipeline-head muted" aria-hidden="true">
          <span />
          <span>Commit on main</span>
          <span>Build</span>
          <span>Chosen</span>
          <span>Running</span>
        </div>
        {(deploys?.services ?? [])
          .filter((row) => row.environments.some((each) => each.environment === environment))
          .map((row) => (
            <PipelineRow key={row.name} row={row} environment={environment} now={now()} />
          ))}
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          A step that stalls says why, in the words the tool used.
        </p>
      </section>
    </main>
  )
}
