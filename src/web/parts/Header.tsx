/** @jsxImportSource solid-js */
/** The header: Estate, the environment switcher with each environment's worst, the pages, live, and who you are. */
import { createSignal, For, Show } from "solid-js"
import type { Health } from "../../shared/events"
import { useEstate, useSnapshot } from "../context"
import { clock, initials } from "../format"
import { A } from "./A"
import { Jump } from "./Jump"

const worstWords: Readonly<Record<Health, string>> = {
  healthy: "all quiet",
  attention: "needs attention",
  critical: "something is down",
  unknown: "not heard from",
}

const Logo = () => (
  <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
    <circle cx="11" cy="11" r="9.5" stroke="#E9ECF2" stroke-width="1.5" />
    <circle cx="11" cy="11" r="4" stroke="#E9ECF2" stroke-width="1.5" />
    <circle cx="11" cy="11" r="1.4" fill="#F5A524" />
  </svg>
)

const Switcher = () => {
  const { actions } = useEstate()
  const snapshot = useSnapshot()
  const [open, setOpen] = createSignal(false)
  const environment = () => snapshot.environment
  const environments = () => snapshot.events.catalog?.environments ?? [{ name: environment(), title: environment() }]
  const worst = (name: string): Health =>
    snapshot.events.services?.environments.find((each) => each.name === name)?.worst ?? "unknown"
  const current = () => environments().find((each) => each.name === environment())
  return (
    <div class="switcher">
      <button
        type="button"
        class="switcher-button"
        aria-expanded={open()}
        aria-label={`Environment: ${environment()}. Change environment`}
        onClick={() => setOpen(!open())}
      >
        <span class={`dot ${worst(environment())}`} />
        <strong>{environment()}</strong>
        <Show when={current()?.title !== current()?.name ? current() : undefined}>
          {(shown) => (
            <span class="mono muted" style={{ "font-size": "11px" }}>
              {shown().title}
            </span>
          )}
        </Show>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="#8C93A3"
          stroke-width="1.5"
          aria-hidden="true"
        >
          <path d="M2 4l3 3 3-3" />
        </svg>
      </button>
      <Show when={open()}>
        <ul aria-label="Environments" class="switcher-list">
          <For each={environments()}>
            {(each) => (
              <li>
                <button
                  type="button"
                  class="switcher-option"
                  aria-current={each.name === environment()}
                  onClick={() => {
                    setOpen(false)
                    actions.choose(each.name)
                  }}
                >
                  <span class={`dot ${worst(each.name)}`} />
                  <span>
                    <strong>{each.name}</strong>{" "}
                    {each.title !== each.name && (
                      <span class="muted" style={{ "font-size": "12px" }}>
                        {each.title}
                      </span>
                    )}
                  </span>
                  <span class="muted" style={{ "font-size": "12px" }}>
                    {worstWords[worst(each.name)]}
                  </span>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  )
}

export const Header = () => {
  const { me, page } = useEstate()
  const snapshot = useSnapshot()
  const firing = () => (snapshot.events.alerts?.alerts ?? []).filter((alert) => alert.state === "firing").length
  const connection = () => snapshot.connection
  return (
    <header class="header">
      <div class="header-inner">
        <A to="/" class="brand">
          <Logo />
          Estate
        </A>
        <Switcher />
        <nav aria-label="Pages" class="nav">
          <A to="/" current={page().page === "overview"}>
            Overview
          </A>
          <A to="/deploys" current={page().page === "deploys"}>
            Deploys
          </A>
          <A to="/alerts" current={page().page === "alerts"}>
            Alerts {firing() > 0 && <span class="count">{firing()}</span>}
          </A>
        </nav>
        <Jump />
        <div class="header-end">
          <span class="live-clock">
            <span
              class={`dot ${connection() === "open" ? "healthy live" : "unknown"}`}
              style={{ width: "7px", height: "7px" }}
            />
            {connection() === "lost" ? "Reconnecting" : connection() === "connecting" ? "Connecting" : "Live"}
            {snapshot.heardAt !== undefined && ` · ${clock(new Date(snapshot.heardAt).toISOString())}`}
          </span>
          <span class="person">
            <span class="avatar" aria-hidden="true">
              {initials(me.name)}
            </span>
            {me.name} · {me.role}
            {me.readOnly === true ? " · read-only" : ""}
            <form method="post" action="/auth/logout">
              <button type="submit" class="plain-button">
                Sign out
              </button>
            </form>
          </span>
        </div>
      </div>
    </header>
  )
}
