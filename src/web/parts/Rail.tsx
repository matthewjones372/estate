/** A service's pipeline in one environment as a rail: commit, build, chosen, running. */
import type { Build, DeploysEvent } from "../../shared/events"
import { since } from "../format"

type Step = "done" | "active" | "stalled" | "waiting"

const looks: Readonly<Record<Step, readonly [string, string, string]>> = {
  done: ["#C8CEDA", "#C8CEDA", "#3A4152"],
  active: ["#0B0D12", "#8FB0FF", "#2A3247"],
  stalled: ["#0B0D12", "#F5A524", "#2A2416"],
  waiting: ["#0B0D12", "#3A4152", "#232836"],
}

const titles = ["Commit", "Build", "Chosen", "Running"] as const

export type Deployed = DeploysEvent["services"][number]["environments"][number]

export interface Pipeline {
  readonly steps: readonly [Step, Step, Step, Step]
  readonly note: string
  readonly tone: "quiet" | "active" | "attention"
  readonly sha: string | undefined
}

const buildStep = (build: Build | undefined): Step => {
  if (build === undefined) return "waiting"
  if (build.status === "success") return "done"
  if (build.status === "failure") return "stalled"
  return build.status === "cancelled" ? "waiting" : "active"
}

export const pipelineOf = (builds: ReadonlyArray<Build>, deployed: Deployed | undefined, now: number): Pipeline => {
  const build = builds[0]
  const chosen = deployed?.chosen
  const stalled = deployed?.stalled
  const chosenStep: Step =
    stalled !== undefined ? "stalled" : chosen === undefined ? "waiting" : chosen.ready ? "done" : "active"
  const running = deployed?.running
  const runningStep: Step =
    running === undefined ? "waiting" : chosen === undefined || chosen.version.includes(running) ? "done" : "active"
  const steps = [build === undefined ? "waiting" : "done", buildStep(build), chosenStep, runningStep] as const
  const sha = build?.sha.slice(0, 7)
  if (stalled !== undefined) return { steps, note: `stalled: ${stalled}`, tone: "attention", sha }
  if (build?.status === "failure") return { steps, note: "build failed", tone: "attention", sha }
  if (build?.status === "running" || build?.status === "queued")
    return { steps, note: `building, ${since(build.at, now)}`, tone: "active", sha }
  if (runningStep === "active") return { steps, note: "rolling out", tone: "active", sha }
  if (running !== undefined && chosen?.at !== undefined)
    return { steps, note: `running, ${since(chosen.at, now)}`, tone: "quiet", sha }
  return { steps, note: running === undefined ? "not running" : "running", tone: "quiet", sha }
}

export const Rail = (props: { readonly pipeline: Pipeline; readonly version: string | undefined }) => {
  const { steps, note, tone, sha } = props.pipeline
  const aria = `Pipeline: ${steps.map((step, index) => `${titles[index]} ${step}`).join(", ")}`
  return (
    <div className="rail-box">
      <div role="img" aria-label={aria} className="rail">
        {steps.map((step, index) => {
          const [fill, ring, bar] = looks[step]
          const last = index === steps.length - 1
          return (
            <span key={titles[index]} className="rail-step" style={{ flex: last ? "0 0 auto" : "1 1 0" }}>
              <span
                title={`${titles[index]}: ${step}`}
                className="rail-dot"
                style={{ background: fill, borderColor: ring }}
              />
              {!last && <span className="rail-bar" style={{ background: bar }} />}
            </span>
          )
        })}
      </div>
      <div className="rail-notes mono">
        <span>{sha ?? ""}</span>
        <span className={`rail-note ${tone}`}>{note}</span>
      </div>
      {props.version !== undefined && <span className="mono rail-version">{props.version}</span>}
    </div>
  )
}
