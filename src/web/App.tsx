/** The signed-in page: the header, then the page the address names. */
import { type Estate, EstateContext } from "./context"
import { Alerts } from "./pages/Alerts"
import { Deploys } from "./pages/Deploys"
import { Overview } from "./pages/Overview"
import { ServicePage } from "./pages/Service"
import { A } from "./parts/A"
import { Header } from "./parts/Header"

const Missing = () => (
  <main className="state-page">
    <h1>There is no such page.</h1>
    <A to="/">The overview</A>
  </main>
)

const Page = (props: { readonly estate: Estate }) => {
  const { page } = props.estate
  switch (page.page) {
    case "overview":
      return <Overview />
    case "service":
      return <ServicePage name={page.name} />
    case "deploys":
      return <Deploys />
    case "alerts":
      return <Alerts />
    case "missing":
      return <Missing />
  }
}

export const App = (props: { readonly estate: Estate }) => (
  <EstateContext.Provider value={props.estate}>
    <Header />
    <Page estate={props.estate} />
  </EstateContext.Provider>
)
