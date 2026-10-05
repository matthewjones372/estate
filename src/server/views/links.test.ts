/** Catalog link templates: env/service fill, and alert placeholders left for the page. */
import { describe, expect, test } from "bun:test"
import { catalog } from "../fixture"
import { catalogView } from "./catalog"

describe("catalog link templates", () => {
  test("leave {alert} and {summary} for the page to fill", () => {
    const withIncident = {
      ...catalog,
      services: [
        {
          name: "orders",
          environments: ["staging"],
          links: {
            incident: "https://pd.example/create?service={service}&env={env}&title={alert}&details={summary}",
          },
        },
      ],
    }
    expect(catalogView(withIncident, "staging").services[0]?.links).toEqual([
      {
        name: "incident",
        url: "https://pd.example/create?service=orders&env=staging&title={alert}&details={summary}",
      },
    ])
  })
})
