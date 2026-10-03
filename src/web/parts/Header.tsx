/** The header: Estate, the environment switcher with each environment's worst, the pages, live, and who you are. */
import { useState } from "react"
import type { Health } from "../../shared/events"
import { useEstate, useSnapshot } from "../context"
import { clock, initials } from "../format"
import { A } from "./A"

const worstWords: Readonly<Record<Health, string>> = {
  healthy: "all quiet",
  attention: "needs attention",
  critical: "something is down",
  unknown: "not heard from",
}

const Logo = () => (
  <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
    <circle cx="11" cy="11" r="9.5" stroke="#E9ECF2" strokeWidth="1.5" />
    <circle cx="11" cy="11" r="4" stroke="#E9ECF2" strokeWidth="1.5" />
    <circle cx="11" cy="11" r="1.4" fill="#F5A524" />
  </svg>
)

const Switcher = () => {
  const { actions } = useEstate()
  const { environment, events } = useSnapshot()
  const [open, setOpen] = useState(false)
  const environments = events.catalog?.environments ?? [{ name: environment, title: environment }]
  const worst = (name: string): Health =>
    events.services?.environments.find((each) => each.name === name)?.worst ?? "unknown"
  const current = environments.find((each) => each.name === environment)
  return (
    <div className="switcher">
      <button
        type="button"
        className="switcher-button"
        aria-expanded={open}
        aria-label={`Environment: ${environment}. Change environment`}
        onClick={() => setOpen(!open)}
      >
        <span className={`dot ${worst(environment)}`} />
        <strong>{environment}</strong>
        {current !== undefined && current.title !== current.name && (
          <span className="mono muted" style={{ fontSize: 11 }}>
            {current.title}
          </span>
        )}
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="#8C93A3"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="M2 4l3 3 3-3" />
        </svg>
      </button>
      {open && (
        <ul aria-label="Environments" className="switcher-list">
          {environments.map((each) => (
            <li key={each.name}>
              <button
                type="button"
                className="switcher-option"
                aria-current={each.name === environment}
                onClick={() => {
                  setOpen(false)
                  actions.choose(each.name)
                }}
              >
                <span className={`dot ${worst(each.name)}`} />
                <span>
                  <strong>{each.name}</strong>{" "}
                  {each.title !== each.name && (
                    <span className="muted" style={{ fontSize: 12 }}>
                      {each.title}
                    </span>
                  )}
                </span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {worstWords[worst(each.name)]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export const Header = () => {
  const { me, page } = useEstate()
  const { events, connection, heardAt } = useSnapshot()
  const live = (events.alerts?.alerts ?? []).filter((alert) => alert.state === "firing").length
  return (
    <header className="header">
      <div className="header-inner">
        <A to="/" className="brand">
          <Logo />
          Estate
        </A>
        <Switcher />
        <nav aria-label="Pages" className="nav">
          <A to="/" current={page.page === "overview"}>
            Overview
          </A>
          <A to="/deploys" current={page.page === "deploys"}>
            Deploys
          </A>
          <A to="/alerts" current={page.page === "alerts"}>
            Alerts {live > 0 && <span className="count">{live}</span>}
          </A>
        </nav>
        <div className="header-end">
          <span className="live-clock">
            <span
              className={`dot ${connection === "open" ? "healthy live" : "unknown"}`}
              style={{ width: 7, height: 7 }}
            />
            {connection === "lost" ? "Reconnecting" : connection === "connecting" ? "Connecting" : "Live"}
            {heardAt !== undefined && ` · ${clock(new Date(heardAt).toISOString())}`}
          </span>
          <span className="person">
            <span className="avatar" aria-hidden="true">
              {initials(me.name)}
            </span>
            {me.name} · {me.role}
            <form method="post" action="/auth/logout">
              <button type="submit" className="plain-button">
                Sign out
              </button>
            </form>
          </span>
        </div>
      </div>
    </header>
  )
}
