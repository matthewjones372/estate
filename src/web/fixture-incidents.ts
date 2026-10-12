/** Incidents as the server sends them, for the incidents' tests. */
import type { Incident, IncidentRecord } from "../shared/incidents"

/** Open, with the fixture's live OrdersSlow and a staging firing that has since resolved. */
const ordersSlow: Incident = {
  id: "i1",
  title: "Orders slow",
  openedBy: "gil",
  openedAt: "2026-10-03T11:50:00Z",
  firings: [
    {
      environment: "production",
      alert: "a1",
      name: "OrdersSlow",
      startsAt: "2026-10-03T11:46:00Z",
      linkedBy: "gil",
      linkedAt: "2026-10-03T11:50:00Z",
    },
    {
      environment: "staging",
      alert: "a9",
      name: "PaymentsDown",
      startsAt: "2026-10-03T11:40:00Z",
      linkedBy: "ada",
      linkedAt: "2026-10-03T11:52:00Z",
    },
  ],
}

const checkoutDown: Incident = {
  id: "i2",
  title: "Checkout down",
  openedBy: "ada",
  openedAt: "2026-10-03T11:30:00Z",
  firings: [],
}

/** Closed, its one firing kept before Estate kept an alert's name with it. */
const searchSlow: Incident = {
  id: "i3",
  title: "Search slow",
  openedBy: "ada",
  openedAt: "2026-10-03T09:00:00Z",
  closedBy: "gil",
  closedAt: "2026-10-03T10:00:00Z",
  ended: "the index was rebuilt",
  firings: [
    {
      environment: "production",
      alert: "a7",
      startsAt: "2026-10-03T08:55:00Z",
      linkedBy: "ada",
      linkedAt: "2026-10-03T09:00:00Z",
    },
  ],
}

export const openIncidents: ReadonlyArray<Incident> = [ordersSlow, checkoutDown]

export const incidentRecords: ReadonlyMap<string, IncidentRecord> = new Map([
  [
    "i1",
    {
      incident: ordersSlow,
      events: [
        {
          id: "e1",
          environment: "staging",
          alert: "a9",
          at: "2026-10-03T11:40:00Z",
          by: "Estate",
          kind: "fired",
          text: "PaymentsDown, critical, payments",
        },
        {
          id: "e2",
          environment: "production",
          alert: "a1",
          at: "2026-10-03T11:46:00Z",
          by: "Estate",
          kind: "fired",
          text: "OrdersSlow, critical, storefront",
        },
        {
          id: "e3",
          environment: "production",
          alert: "a1",
          at: "2026-10-03T11:50:00Z",
          by: "gil",
          kind: "incident-opened",
          text: "Orders slow",
        },
        {
          id: "e4",
          environment: "staging",
          alert: "a9",
          at: "2026-10-03T11:52:00Z",
          by: "ada",
          kind: "incident-linked",
          text: "Orders slow",
        },
        {
          id: "e5",
          environment: "staging",
          alert: "a9",
          at: "2026-10-03T11:55:00Z",
          by: "Estate",
          kind: "resolved",
          text: "after 15 min",
        },
      ],
    },
  ],
  ["i2", { incident: checkoutDown, events: [] }],
  ["i3", { incident: searchSlow, events: [] }],
])
