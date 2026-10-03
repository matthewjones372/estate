/** @jsxImportSource solid-js */
/** The page's entry: who is asking first, then the live page for the environment chosen. */
import { Option, Schema } from "effect"
import type { JSX } from "solid-js"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import { Me } from "../shared/events"
import "./styles/base.css"
import "./styles/header.css"
import "./styles/overview.css"
import "./styles/parts.css"
import "./styles/alerts.css"
import "./styles/map.css"
import "./styles/pages.css"
import "./styles/service.css"
import "./styles/logs.css"
import "./styles/kiosk.css"
import { App } from "./App"
import { openEvents, serverActions } from "./connect"
import { kept } from "./kept"
import { createLive } from "./live"
import { NoAccess, SignIn } from "./pages/States"
import { chooseEnvironment, pageOf } from "./route"

const storage = kept("estate.environment")

const element = document.getElementById("estate")
const show = (page: () => JSX.Element) => {
  if (element === null) return
  element.replaceChildren()
  render(page, element)
}

const here = () => `${window.location.pathname}${window.location.search}`

const boot = async () => {
  const response = await fetch("/api/me")
  if (response.status === 401) return show(() => <SignIn returnTo={here()} />)
  if (response.status === 403) {
    const body: { name?: string; groups?: string[] } = await response.json()
    return show(() => <NoAccess name={body.name ?? "someone"} groups={body.groups ?? []} />)
  }
  const me = Option.getOrUndefined(Schema.decodeUnknownOption(Me)(await response.json()))
  if (me === undefined) return show(() => <SignIn returnTo={here()} />)

  const params = new URLSearchParams(window.location.search)
  // A screen starts at the first of its own environments, whatever this browser last chose.
  const screen = pageOf(window.location.pathname).page === "kiosk"
  const environment =
    chooseEnvironment(
      params.get("env"),
      screen ? null : storage.read(),
      screen ? (me.screen?.environments ?? me.environments) : me.environments,
    ) ?? ""
  const live = createLive(openEvents, environment)
  /** The path with the environment chosen; the page's own other parameters, a screen's `team`, kept where it stays. */
  const withEnvironment = (path: string) => {
    const params = new URLSearchParams(path === window.location.pathname ? window.location.search : "")
    params.set("env", live.snapshot().environment)
    return `${path}?${params}`
  }

  const [page, setPage] = createSignal(pageOf(window.location.pathname, window.location.search))
  const actions = serverActions(() => live.snapshot().environment, {
    navigate: (path) => {
      window.history.pushState(null, "", withEnvironment(path))
      window.scrollTo(0, 0)
      setPage(pageOf(path))
    },
    choose: (chosen) => {
      live.choose(chosen)
      storage.write(chosen)
      window.history.replaceState(null, "", withEnvironment(window.location.pathname))
    },
  })
  window.addEventListener("popstate", () => setPage(pageOf(window.location.pathname, window.location.search)))
  storage.write(environment)
  window.history.replaceState(null, "", withEnvironment(window.location.pathname))
  show(() => <App estate={{ live, me, page, actions, now: Date.now }} />)
}

void boot()
