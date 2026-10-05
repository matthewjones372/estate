/** @jsxImportSource solid-js */
/** Raise incident on alert context: run by `incident-ui.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import type { Alert, Events } from "../shared/events"
import { events } from "./fixture"
import { mount } from "./harness"
import { AlertPage } from "./pages/Alert"
import { AlertCard } from "./parts/AlertCard"
import { Links } from "./parts/Lane"

const alert = (): Alert => {
  const found = events.alerts?.alerts[0]
  if (found === undefined) throw new Error("no alert in fixture")
  return found
}

const storefront = () => {
  const found = events.catalog?.services.find((each) => each.name === "storefront")
  if (found === undefined) throw new Error("no storefront in fixture")
  return found
}

const withoutIncident = (): Events => {
  const described = storefront()
  const catalog = events.catalog
  if (catalog === undefined) throw new Error("no catalog in fixture")
  return {
    ...events,
    catalog: {
      ...catalog,
      services: [
        {
          ...described,
          links: described.links.filter((link) => link.name !== "incident" && link.name !== "raise-incident"),
        },
        ...catalog.services.filter((each) => each.name !== "storefront"),
      ],
    },
  }
}

const raise = (root: ParentNode) =>
  [...root.querySelectorAll("a")].find((each) => each.textContent?.includes("Raise incident"))

describe("Raise incident", () => {
  test("appears on the alert card when the catalog link is configured, with placeholders filled", () => {
    const page = mount(() => <AlertCard alert={alert()} catalog={events.catalog} canSilence={false} />)
    const link = raise(page.container)
    expect(link?.getAttribute("href")).toBe(
      "https://pd.example/create?service=storefront&title=OrdersSlow&details=Orders%20are%20slow",
    )
    expect(link?.getAttribute("target")).toBe("_blank")
    page.dispose()
  })

  test("is hidden when the catalog has no incident link", () => {
    const sent = withoutIncident()
    const card = mount(() => <AlertCard alert={alert()} catalog={sent.catalog} canSilence={false} />)
    expect(raise(card.container)).toBeUndefined()
    card.dispose()
    const page = mount(() => <AlertPage id="a1" />, { sent })
    expect(raise(page.container)).toBeUndefined()
    page.dispose()
  })

  test("shows on the alert permalink and as a service link chip", () => {
    const page = mount(() => <AlertPage id="a1" />)
    expect(raise(page.container)?.getAttribute("href")).toBe(
      "https://pd.example/create?service=storefront&title=OrdersSlow&details=Orders%20are%20slow",
    )
    page.dispose()
    const chip = mount(() => <Links service={storefront()} />)
    expect(raise(chip.container)?.getAttribute("href")).toBe(
      "https://pd.example/create?service=storefront&title=&details=",
    )
    chip.dispose()
  })
})
