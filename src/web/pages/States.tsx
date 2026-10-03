/** The states that are not the estate: signed out, signed in with no role, and the sources as they answer. */
import type { ServicesEvent, SourceKind, SourceStatus } from "../../shared/events"
import { clock, since } from "../format"

const sourceNames: Readonly<Record<SourceKind, string>> = {
  alerts: "Alerts",
  cluster: "Kubernetes",
  deploys: "Flux",
  metrics: "Prometheus",
  builds: "GitHub",
}

const parts: Readonly<Record<SourceKind, string>> = {
  alerts: "alerts",
  cluster: "pods, versions and debug",
  deploys: "what Flux chose",
  metrics: "load, vitals and the map's rates",
  builds: "builds",
}

export const SignIn = (props: { readonly returnTo: string }) => (
  <main className="state-page">
    <h1>Sign in to see the estate.</h1>
    <p className="lede">Estate shows versions, alerts and logs, so it asks who you are first.</p>
    <a className="primary-button" href={`/auth/login?returnTo=${encodeURIComponent(props.returnTo)}`}>
      Sign in
    </a>
  </main>
)

export const NoAccess = (props: { readonly name: string; readonly groups: ReadonlyArray<string> }) => (
  <main className="state-page">
    <h1>
      You are signed in as {props.name},<br />
      but not in a group that may see the estate.
    </h1>
    <p className="lede">
      It is open to {props.groups.length === 0 ? "nobody yet" : props.groups.join(", ")}. Ask an admin to add you to
      one; it takes effect when you next sign in.
    </p>
    <form method="post" action="/auth/logout">
      <button type="submit" className="primary-button">
        Sign in as someone else
      </button>
    </form>
  </main>
)

const Tick = (props: { readonly done: boolean }) => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 12 12"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d={props.done ? "M2 6.2 4.6 8.6 10 3" : "M6 1.5a4.5 4.5 0 1 0 4.5 4.5"} />
  </svg>
)

const stateWords: Readonly<Record<SourceStatus["state"], string>> = {
  ok: "read",
  waiting: "reading…",
  failing: "did not answer",
  off: "not set up",
}

/** The first load: each source ticked off as it answers, so the page is never blank. */
export const Reading = (props: { readonly sources: ReadonlyArray<SourceStatus> | undefined }) => (
  <section aria-labelledby="loading" className="panel reading">
    <h2 id="loading" className="section-title">
      Reading the estate
    </h2>
    {props.sources === undefined ? (
      <p className="muted" style={{ margin: 0 }}>
        Connecting to Estate…
      </p>
    ) : (
      <ul className="source-list">
        {props.sources
          .filter((source) => source.state !== "off")
          .map((source) => (
            <li key={source.kind} style={{ color: source.state === "ok" ? "var(--ink)" : "var(--ink-2)" }}>
              <Tick done={source.state === "ok"} />
              {sourceNames[source.kind]} <span className="muted">{stateWords[source.state]}</span>
            </li>
          ))}
      </ul>
    )}
    <p className="muted" style={{ margin: 0, fontSize: 13 }}>
      Each part appears as its source answers. Never a blank page.
    </p>
  </section>
)

/** A line for each source that did not answer, and one for those not set up. */
export const SourceNotices = (props: { readonly services: ServicesEvent | undefined; readonly now: number }) => {
  const sources = props.services?.sources ?? []
  const failing = sources.filter((source) => source.state === "failing")
  const off = sources.filter((source) => source.state === "off")
  return (
    <>
      {failing.map((source) => (
        <div key={source.kind} role="status" className="notice">
          <strong style={{ color: "var(--ink)" }}>{sourceNames[source.kind]} did not answer.</strong>
          <span>
            {parts[source.kind]}{" "}
            {source.answeredAt === undefined
              ? "are not known yet"
              : `are as of ${clock(source.answeredAt)}, ${since(source.answeredAt, props.now)} ago`}
            , and greyed until it answers.
            {source.message === undefined ? "" : ` It said: ${source.message}`}
          </span>
        </div>
      ))}
      {off.length > 0 && (
        <div className="notice">
          Not set up here: {off.map((source) => `${sourceNames[source.kind]} (${parts[source.kind]})`).join(", ")}.
        </div>
      )}
    </>
  )
}
