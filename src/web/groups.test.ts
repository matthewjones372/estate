import { describe, expect, test } from "bun:test"
import { groupsOf, otherwise } from "./groups"

const service = (name: string, category?: string) => ({
  name,
  links: [],
  ...(category === undefined ? {} : { category }),
})
const store = (name: string, category?: string) => ({
  name,
  engine: "postgres",
  links: [],
  ...(category === undefined ? {} : { category }),
})
const catalog = (
  services: ReadonlyArray<ReturnType<typeof service>>,
  stores: ReadonlyArray<ReturnType<typeof store>> = [],
) => ({
  environment: "production",
  environments: [],
  services,
  stores,
  vitals: [],
  map: { nodes: [], edges: [] },
})

describe("the overview's groups", () => {
  test("are one, untitled, when the catalog names no category", () => {
    const listed = catalog([service("a"), service("b")], [store("db")])
    expect(groupsOf(listed)).toEqual([{ services: listed.services, stores: listed.stores, jobs: [] }])
    expect(groupsOf(undefined)).toEqual([{ services: [], stores: [], jobs: [] }])
  })

  test("are a category each, in the order first named, services and stores together, and the rest last", () => {
    const groups = groupsOf(
      catalog(
        [service("a", "Data"), service("b"), service("c", "Payments")],
        [store("db", "Payments"), store("cache")],
      ),
    )
    expect(
      groups.map((group) => [
        group.title,
        group.services.map((each) => each.name),
        group.stores.map((each) => each.name),
      ]),
    ).toEqual([
      ["Data", ["a"], []],
      ["Payments", ["c"], ["db"]],
      [otherwise, ["b"], ["cache"]],
    ])
    expect(groupsOf(catalog([service("a", "Data")])).map((group) => group.title)).toEqual(["Data"])
    const withJobs = {
      ...catalog([service("a", "Data")]),
      jobs: [
        { name: "settle", kind: "CronJob" as const, links: [], category: "Data" },
        { name: "export", kind: "Job" as const, links: [] },
      ],
    }
    expect(groupsOf(withJobs).map((group) => [group.title, group.jobs.map((each) => each.name)])).toEqual([
      ["Data", ["settle"]],
      [otherwise, ["export"]],
    ])
  })
})
