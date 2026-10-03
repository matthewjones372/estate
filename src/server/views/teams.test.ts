import { describe, expect, test } from "bun:test"
import { catalog } from "../fixture"
import { catalogView } from "./catalog"

describe("the catalog's teams", () => {
  test("are sent with their titles and their links filled in for the environment", () => {
    const withTeams = {
      ...catalog,
      teams: [
        {
          name: "web",
          title: "Web",
          links: { slack: "https://slack.example/{team}", wiki: "https://wiki.example/{env}" },
        },
        { name: "data" },
      ],
    }
    expect(catalogView(withTeams, "production").teams).toEqual([
      {
        name: "web",
        title: "Web",
        links: [
          { name: "slack", url: "https://slack.example/web" },
          { name: "wiki", url: "https://wiki.example/production" },
        ],
      },
      { name: "data", title: "data", links: [] },
    ])
    expect(catalogView(catalog, "production").teams).toBeUndefined()
  })
})
