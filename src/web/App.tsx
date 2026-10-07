/** @jsxImportSource solid-js */
/** The signed-in page: the header, then the page the address names. */
import { Match, Show, Switch } from "solid-js"
import { type Estate, EstateContext } from "./context"
import { AgentPage } from "./pages/Agent"
import { AlertPage } from "./pages/Alert"
import { Alerts } from "./pages/Alerts"
import { Deploys } from "./pages/Deploys"
import { FiringPage } from "./pages/Firing"
import { JobPage } from "./pages/Job"
import { Kiosk } from "./pages/Kiosk"
import { Overview } from "./pages/Overview"
import { ServicePage } from "./pages/Service"
import { StorePage } from "./pages/Store"
import { A } from "./parts/A"
import { Header } from "./parts/Header"

const Missing = () => (
  <main class="state-page">
    <h1>There is no such page.</h1>
    <A to="/">The overview</A>
  </main>
)

const Page = (props: { readonly estate: Estate }) => {
  const page = () => props.estate.page()
  const service = () => {
    const now = page()
    return now.page === "service" ? now.name : undefined
  }
  const store = () => {
    const now = page()
    return now.page === "store" ? now.name : undefined
  }
  const job = () => {
    const now = page()
    return now.page === "job" ? now.name : undefined
  }
  const agent = () => {
    const now = page()
    return now.page === "agent" ? now.name : undefined
  }
  const alert = () => {
    const now = page()
    return now.page === "alert" ? now.id : undefined
  }
  const firing = () => {
    const now = page()
    return now.page === "firing" ? now : undefined
  }
  return (
    <Switch fallback={<Missing />}>
      <Match when={page().page === "overview"}>
        <Overview />
      </Match>
      <Match when={service()}>{(name) => <ServicePage name={name()} />}</Match>
      <Match when={store()}>{(name) => <StorePage name={name()} />}</Match>
      <Match when={job()}>{(name) => <JobPage name={name()} />}</Match>
      <Match when={agent()}>{(name) => <AgentPage name={name()} />}</Match>
      <Match when={alert()}>{(id) => <AlertPage id={id()} />}</Match>
      <Match when={firing()}>{(firing) => <FiringPage id={firing().id} at={firing().at} />}</Match>
      <Match when={page().page === "deploys"}>
        <Deploys />
      </Match>
      <Match when={page().page === "alerts"}>
        <Alerts />
      </Match>
    </Switch>
  )
}

const kioskOf = (page: ReturnType<Estate["page"]>) =>
  page.page === "kiosk" ? { team: page.team, category: page.category } : {}

export const App = (props: { readonly estate: Estate }) => (
  <EstateContext.Provider value={props.estate}>
    <Show
      when={props.estate.page().page === "kiosk"}
      fallback={
        <>
          <Header />
          <Page estate={props.estate} />
        </>
      }
    >
      <Kiosk {...kioskOf(props.estate.page())} />
    </Show>
  </EstateContext.Provider>
)
