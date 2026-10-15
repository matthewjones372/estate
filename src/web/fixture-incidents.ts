/** Incidents as the server sends them, and actions that answer as the server would, for the incidents' tests. */
import type { Incident, IncidentRecord } from "../shared/incidents"
import { allSeenLive } from "../shared/timeline"
import type { Actions } from "./context"

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
  notes: [{ id: "n1", at: "2026-10-03T11:53:00Z", by: "gil", text: "payments retried\nwatching" }],
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

const openIncidents: ReadonlyArray<Incident> = [ordersSlow, checkoutDown]
export const keptIncidents: ReadonlyArray<Incident> = [...openIncidents, searchSlow]

/** The firing of Orders slow that the firings that may belong to it are like. */
const inOrdersSlow = { environment: "production", alert: "a1", name: "OrdersSlow", about: "storefront" }

const incidentRecords: ReadonlyMap<string, IncidentRecord> = new Map([
  [
    "i1",
    {
      incident: ordersSlow,
      services: ["storefront", "payments"],
      window: { from: "2026-10-03T11:10:00Z", to: "2026-10-03T12:00:00Z" },
      events: allSeenLive([
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
          id: "e6",
          environment: "production",
          alert: "a1",
          at: "2026-10-03T11:53:00Z",
          by: "gil",
          kind: "incident-noted",
          text: "payments retried",
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
      ]),
      suggested: [
        {
          environment: "production",
          alert: "a3",
          name: "QueueGrowing",
          about: "storefront",
          why: "same service",
          to: inOrdersSlow,
          apart: 12,
        },
        {
          environment: "staging",
          alert: "a8",
          name: "OrdersSlow",
          about: "storefront",
          why: "same alert",
          to: inOrdersSlow,
          apart: -1,
        },
      ],
    },
  ],
  ["i2", { incident: checkoutDown, events: [] }],
  ["i3", { incident: searchSlow, events: [] }],
])

type Calls = Array<readonly [string, ...ReadonlyArray<unknown>]>

/** The incidents' actions, recording what they were asked; a note added or removed is read back as the server would. */
export const incidentActions = (
  calls: Calls,
): Pick<
  Actions,
  | "incidents"
  | "incident"
  | "openIncident"
  | "linkIncident"
  | "unlinkIncident"
  | "closeIncident"
  | "addIncidentNote"
  | "addIncidentService"
  | "addIncidentHappened"
  | "keepIncidentEvidence"
  | "removeIncidentNote"
  | "dismissIncident"
  | "raiseIncident"
> => {
  const records = new Map(incidentRecords)
  const found = (id: string) => records.get(id)?.incident
  const noted = (
    id: string,
    notes: (incident: Incident) => NonNullable<Incident["notes"]>,
  ): Promise<Incident | string> => {
    const record = records.get(id)
    if (record === undefined) return Promise.resolve("there is no such incident")
    const incident: Incident = { ...record.incident, notes: notes(record.incident) }
    records.set(id, { ...record, incident })
    return Promise.resolve(incident)
  }
  /** The record without `alert` among what may belong to it, and with `firings`, as the server would read it back. */
  const mayBelongNo = (
    id: string,
    alert: string,
    firings: (incident: Incident) => Incident["firings"],
  ): Promise<Incident | string> => {
    const record = records.get(id)
    if (record === undefined) return Promise.resolve("there is no such incident")
    const incident: Incident = { ...record.incident, firings: firings(record.incident) }
    const suggested = (record.suggested ?? []).filter((each) => each.alert !== alert)
    records.set(id, { ...record, incident, suggested })
    return Promise.resolve(incident)
  }
  return {
    incidents: () => {
      calls.push(["incidents"])
      return Promise.resolve(openIncidents)
    },
    incident: (id) => {
      calls.push(["incident", id])
      return Promise.resolve(id === "broken" ? undefined : (records.get(id) ?? "none"))
    },
    openIncident: (title, alert) => {
      calls.push(["openIncident", title, alert])
      return Promise.resolve({
        id: "i9",
        title,
        openedBy: "ada lovelace",
        openedAt: "2026-10-03T12:00:00Z",
        firings: [],
      })
    },
    // Checkout down closed in the meantime, so linking to it is refused.
    linkIncident: (id, alert, environment) => {
      calls.push(environment === undefined ? ["linkIncident", id, alert] : ["linkIncident", id, alert, environment])
      const may = records.get(id)?.suggested?.find((each) => each.alert === alert && each.environment === environment)
      if (may !== undefined) {
        const firing = { environment: may.environment, alert, name: may.name, startsAt: "2026-10-03T11:58:00Z" }
        return mayBelongNo(id, alert, (incident) => [
          ...incident.firings,
          { ...firing, linkedBy: "ada lovelace", linkedAt: "2026-10-03T12:00:00Z" },
        ])
      }
      const open = openIncidents.find((each) => each.id === id)
      return Promise.resolve(open === undefined || id === "i2" ? `"Checkout down" is closed` : open)
    },
    unlinkIncident: (id, environment, alert, startsAt) => {
      calls.push(["unlinkIncident", id, environment, alert, startsAt])
      const incident = found(id)
      return Promise.resolve(
        incident === undefined
          ? "there is no such incident"
          : { ...incident, firings: incident.firings.filter((each) => each.alert !== alert) },
      )
    },
    closeIncident: (id, how) => {
      calls.push(["closeIncident", id, how])
      const incident = found(id)
      return Promise.resolve(
        incident === undefined
          ? "there is no such incident"
          : { ...incident, closedBy: "ada lovelace", closedAt: "2026-10-03T12:00:00Z", ended: how },
      )
    },
    addIncidentNote: (id, text) => {
      calls.push(["addIncidentNote", id, text])
      const note = { id: `n${calls.length}`, at: "2026-10-03T12:00:00Z", by: "ada lovelace", text }
      return noted(id, (incident) => [...(incident.notes ?? []), note])
    },
    addIncidentHappened: (id, text, at) => {
      calls.push(at === undefined ? ["addIncidentHappened", id, text] : ["addIncidentHappened", id, text, at])
      return Promise.resolve(records.has(id) ? true : "there is no such incident")
    },
    keepIncidentEvidence: (id) => {
      calls.push(["keepIncidentEvidence", id])
      return Promise.resolve(records.has(id) ? true : "there is no such incident")
    },
    addIncidentService: (id, service) => {
      calls.push(["addIncidentService", id, service])
      const record = records.get(id)
      if (record === undefined) return Promise.resolve("there is no such incident")
      const added = { service, by: "ada lovelace", at: "2026-10-03T12:00:00Z" }
      const incident: Incident = { ...record.incident, added: [...(record.incident.added ?? []), added] }
      records.set(id, { ...record, incident, services: [...(record.services ?? []), service] })
      return Promise.resolve(incident)
    },
    dismissIncident: (id, alert, environment) => {
      calls.push(
        environment === undefined ? ["dismissIncident", id, alert] : ["dismissIncident", id, alert, environment],
      )
      return mayBelongNo(id, alert, (incident) => incident.firings)
    },
    // Checkout down cannot be raised: the tool refuses it, in its words.
    raiseIncident: (id) => {
      calls.push(["raiseIncident", id])
      if (id === "i2") return Promise.resolve("PagerDuty answered 400: Invalid Input Provided: Service not found")
      const record = records.get(id) ?? {
        incident: { id, title: "", openedBy: "ada lovelace", openedAt: "2026-10-03T12:00:00Z", firings: [] },
        events: [],
      }
      const link = "https://example.pagerduty.com/incidents/Q1ABC"
      const raised = { tool: "PagerDuty", id: "Q1ABC", by: "ada lovelace", at: "2026-10-03T12:00:00Z" }
      const incident: Incident = { ...record.incident, link, raised }
      records.set(id, { ...record, incident })
      return Promise.resolve(incident)
    },
    removeIncidentNote: (id, note) => {
      calls.push(["removeIncidentNote", id, note])
      return noted(id, (incident) => (incident.notes ?? []).filter((each) => each.id !== note))
    },
  }
}
