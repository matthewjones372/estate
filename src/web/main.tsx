/** The page's entry: who is asking first, then the live page for the environment chosen. */
import { Option, Schema } from "effect"
import { createRoot } from "react-dom/client"
import { Me } from "../shared/events"
import "./styles/base.css"
import "./styles/header.css"
import "./styles/overview.css"
import "./styles/parts.css"
import "./styles/alerts.css"
import "./styles/map.css"
import "./styles/pages.css"
import "./styles/service.css"
import { App } from "./App"
import { openEvents, serverActions } from "./connect"
import { createLive } from "./live"
import { NoAccess, SignIn } from "./pages/States"
import { chooseEnvironment, pageOf } from "./route"

const remembered = "estate.environment"

const storage = {
  read: (): string | null => {
    try {
      return window.localStorage.getItem(remembered)
    } catch {
      return null
    }
  },
  write: (value: string) => {
    try {
      window.localStorage.setItem(remembered, value)
    } catch {
      return
    }
  },
}

const element = document.getElementById("estate")
const root = element === null ? undefined : createRoot(element)

const here = () => `${window.location.pathname}${window.location.search}`

const boot = async () => {
  const response = await fetch("/api/me")
  if (response.status === 401) return root?.render(<SignIn returnTo={here()} />)
  if (response.status === 403) {
    const body: { name?: string; groups?: string[] } = await response.json()
    return root?.render(<NoAccess name={body.name ?? "someone"} groups={body.groups ?? []} />)
  }
  const me = Option.getOrUndefined(Schema.decodeUnknownOption(Me)(await response.json()))
  if (me === undefined) return root?.render(<SignIn returnTo={here()} />)

  const params = new URLSearchParams(window.location.search)
  const environment = chooseEnvironment(params.get("env"), storage.read(), me.environments) ?? ""
  const live = createLive(openEvents, environment)
  const withEnvironment = (path: string) => `${path}?env=${encodeURIComponent(live.snapshot().environment)}`

  const render = () => {
    const actions = serverActions(() => live.snapshot().environment, {
      navigate: (path) => {
        window.history.pushState(null, "", withEnvironment(path))
        window.scrollTo(0, 0)
        render()
      },
      choose: (chosen) => {
        live.choose(chosen)
        storage.write(chosen)
        window.history.replaceState(null, "", withEnvironment(window.location.pathname))
        render()
      },
    })
    root?.render(<App estate={{ live, me, page: pageOf(window.location.pathname), actions, now: Date.now }} />)
  }
  window.addEventListener("popstate", render)
  storage.write(environment)
  window.history.replaceState(null, "", withEnvironment(window.location.pathname))
  render()
}

void boot()
