/** @jsxImportSource solid-js */
/** The signed-in page: the header, then the page the address names. */
import { Match, Show, Switch } from "solid-js"
import { type Estate, EstateContext } from "./context"
import { Alerts } from "./pages/Alerts"
import { Deploys } from "./pages/Deploys"
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
  return (
    <Switch fallback={<Missing />}>
      <Match when={page().page === "overview"}>
        <Overview />
      </Match>
      <Match when={service()}>{(name) => <ServicePage name={name()} />}</Match>
      <Match when={store()}>{(name) => <StorePage name={name()} />}</Match>
      <Match when={page().page === "deploys"}>
        <Deploys />
      </Match>
      <Match when={page().page === "alerts"}>
        <Alerts />
      </Match>
    </Switch>
  )
}

const kioskTeam = (page: ReturnType<Estate["page"]>) => (page.page === "kiosk" ? page.team : undefined)

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
      <Kiosk team={kioskTeam(props.estate.page())} />
    </Show>
  </EstateContext.Provider>
)
