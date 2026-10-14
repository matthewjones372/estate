import { describe, expect, test } from "bun:test"
import { Option } from "effect"
import type { Catalog } from "../../shared/catalog"
import type { Incident } from "../../shared/incidents"
import { catalog, environment, estate } from "../fixture"
import type { EstateState, SourcedAlert, StoredFiring } from "../state"
import { mayBelongTo, suggestedFor } from "./suggested"

const ok = <A>(value: A) => ({ state: "ok" as const, value, answeredAt: "2026-10-03T12:00:00Z" })

const withStore: Catalog = {
  ...catalog,
  stores: [{ name: "orders-db", environments: ["production"], engine: "postgres", selector: 'db="orders"' }],
}

const at = (minute: number) => `2026-10-03T09:${String(minute).padStart(2, "0")}:00Z`

const held = (id: string, name: string, labels: Record<string, string>, minute = 0): SourcedAlert => ({
  id,
  name,
  state: "firing",
  severity: "critical",
  startsAt: at(minute),
  labels,
})

const incident = (id: string, firings: ReadonlyArray<{ environment: string; alert: string }>, more = {}): Incident => ({
  id,
  title: `Incident ${id}`,
  openedBy: "gil",
  openedAt: at(1),
  firings: firings.map((each) => ({ ...each, startsAt: at(0), linkedBy: "gil", linkedAt: at(1) })),
  ...more,
})

const on = (
  incidents: ReadonlyArray<Incident>,
  production: ReadonlyArray<SourcedAlert>,
  more: { readonly staging?: ReadonlyArray<SourcedAlert>; readonly firings?: ReadonlyArray<StoredFiring> } = {},
): EstateState =>
  estate({
    catalog: withStore,
    environments: {
      staging: environment({ alerts: ok(more.staging ?? []) }),
      production: environment({ alerts: ok(production) }),
    },
    incidents,
    firings: more.firings ?? [],
  })

/** An alert as the alerts view gives it: firing, with its service or store. */
const firing = (id: string, name: string, minute: number, about: { service?: string; store?: string }) => ({
  id,
  name,
  state: "firing" as const,
  startsAt: at(minute),
  ...about,
})

const ordersSlow = held("o1", "OrdersSlow", { service: "orders" })
const slow = incident("i1", [{ environment: "production", alert: "o1" }])
const fromOrders = { environment: "production", alert: "o1", name: "OrdersSlow", about: "orders" }

describe("a firing that may belong to an incident", () => {
  test("is the same alert in another environment", () =>
    expect(
      suggestedFor(on([slow], [ordersSlow]), "staging", firing("s1", "OrdersSlow", 10, { service: "orders" }), 30),
    ).toEqual(
      Option.some({ incident: { id: "i1", title: "Incident i1" }, why: "same alert", to: fromOrders, apart: 10 }),
    ))

  test("is on the same service in the same environment", () =>
    expect(
      suggestedFor(on([slow], [ordersSlow]), "production", firing("o2", "OrdersErrors", 4, { service: "orders" }), 30),
    ).toEqual(
      Option.some({ incident: { id: "i1", title: "Incident i1" }, why: "same service", to: fromOrders, apart: 4 }),
    ))

  test("is on the same store, the incident's firing read from its kept record once it has resolved", () => {
    const kept: StoredFiring = {
      environment: "production",
      alert: "d1",
      name: "PoolFull",
      store: "orders-db",
      startsAt: at(0),
    }
    const full = incident("i2", [{ environment: "production", alert: "d1" }])
    expect(
      suggestedFor(
        on([full], [], { firings: [kept] }),
        "production",
        firing("d2", "SlowQueries", 0, { store: "orders-db" }),
        30,
      ),
    ).toEqual(
      Option.some({
        incident: { id: "i2", title: "Incident i2" },
        why: "same store",
        to: { environment: "production", alert: "d1", name: "PoolFull", about: "orders-db" },
        apart: 0,
      }),
    )
  })

  test("is next to it on the map, either way, said from its own side", () => {
    const later = incident("i7", [{ environment: "production", alert: "o1" }])
    const anchored = { ...later, firings: later.firings.map((each) => ({ ...each, startsAt: at(3) })) }
    const near = (id: string, service: string) =>
      suggestedFor(on([anchored], [ordersSlow]), "production", firing(id, "Slow", 0, { service }), 30).pipe(
        Option.map((each) => [each.why, each.side, each.apart]),
      )
    expect(near("f1", "storefront")).toEqual(Option.some(["next to it", "calls", -3]))
    expect(near("p1", "payments")).toEqual(Option.some(["next to it", "called by", -3]))
  })

  test("is not one that started outside the window", () =>
    expect(
      Option.isNone(
        suggestedFor(
          on([slow], [ordersSlow]),
          "production",
          firing("o2", "OrdersErrors", 31, { service: "orders" }),
          30,
        ),
      ),
    ).toBe(true))

  test("is not one related only by time and environment", () =>
    expect(
      Option.isNone(
        suggestedFor(on([slow], [ordersSlow]), "production", firing("x1", "SearchSlow", 2, { service: "search" }), 30),
      ),
    ).toBe(true))

  test("is not one two edges away on the map", () => {
    const paying = incident("i3", [{ environment: "production", alert: "p1" }])
    const payments = held("p1", "PaymentsSlow", { service: "payments" })
    expect(
      Option.isNone(
        suggestedFor(
          on([paying], [payments]),
          "production",
          firing("f1", "CheckoutSlow", 2, { service: "storefront" }),
          30,
        ),
      ),
    ).toBe(true)
  })

  test("is not one already in an open incident", () => {
    const other = incident("i4", [{ environment: "production", alert: "o2" }])
    expect(
      Option.isNone(
        suggestedFor(
          on([slow, other], [ordersSlow]),
          "production",
          { ...firing("o2", "OrdersErrors", 0, { service: "orders" }) },
          30,
        ),
      ),
    ).toBe(true)
  })

  test("is not one dismissed from that incident", () => {
    const dismissed = { environment: "production", alert: "o2", startsAt: at(4), by: "ada", at: at(6) }
    const said = incident("i1", [{ environment: "production", alert: "o1" }], { dismissed: [dismissed] })
    expect(
      Option.isNone(
        suggestedFor(
          on([said], [ordersSlow]),
          "production",
          firing("o2", "OrdersErrors", 4, { service: "orders" }),
          30,
        ),
      ),
    ).toBe(true)
  })

  test("is not one for a closed incident, nor one not firing", () => {
    const closed = { ...slow, closedBy: "gil", closedAt: at(20), ended: "fixed" }
    const errors = firing("o2", "OrdersErrors", 4, { service: "orders" })
    expect(Option.isNone(suggestedFor(on([closed], [ordersSlow]), "production", errors, 30))).toBe(true)
    expect(
      Option.isNone(suggestedFor(on([slow], [ordersSlow]), "production", { ...errors, state: "pending" }, 30)),
    ).toBe(true)
  })

  test("that fits two incidents is suggested for the stronger relation, then the nearer in time", () => {
    const checkout = incident("i5", [{ environment: "production", alert: "f1" }])
    const front = held("f1", "CheckoutSlow", { service: "storefront" })
    const errors = firing("o2", "OrdersErrors", 25, { service: "orders" })
    const state = on([checkout, slow], [front, ordersSlow])
    expect(suggestedFor(state, "production", errors, 30).pipe(Option.map((each) => each.incident.id))).toEqual(
      Option.some("i1"),
    )
    const later = { ...incident("i6", [{ environment: "production", alert: "o3" }]) }
    const nearer = { ...later, firings: later.firings.map((each) => ({ ...each, startsAt: at(20) })) }
    const latency = held("o3", "OrdersLatency", { service: "orders" }, 20)
    expect(
      suggestedFor(on([slow, nearer], [ordersSlow, latency]), "production", errors, 30).pipe(
        Option.map((each) => [each.incident.id, each.apart]),
      ),
    ).toEqual(Option.some(["i6", 5]))
  })

  test("on an incident's page are every live firing suggested for it, in any environment, strongest first", () => {
    const state = on(
      [slow],
      [
        ordersSlow,
        held("o2", "OrdersErrors", { service: "orders" }, 4),
        held("f1", "CheckoutSlow", { service: "storefront" }, 2),
      ],
      {
        staging: [held("s1", "OrdersSlow", { service: "orders" }, 10)],
      },
    )
    expect(
      mayBelongTo(state, "i1", 30).map((each) => [each.environment, each.alert, each.name, each.about, each.why]),
    ).toEqual([
      ["staging", "s1", "OrdersSlow", "orders", "same alert"],
      ["production", "o2", "OrdersErrors", "orders", "same service"],
      ["production", "f1", "CheckoutSlow", "storefront", "next to it"],
    ])
    expect(mayBelongTo(state, "i9", 30)).toEqual([])
  })
})
