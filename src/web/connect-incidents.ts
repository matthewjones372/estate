/** The incidents' actions against the server: read them, and change one, answering with it as it now is. */
import { Option, Schema } from "effect"
import { EvidenceSet } from "../shared/evidence"
import { Incident, IncidentRecord } from "../shared/incidents"
import type { Actions } from "./context"
import { decodeMessage, refusalOf } from "./refusal"

const decodeIncident = Schema.decodeUnknownOption(Incident)
const decodeIncidents = Schema.decodeUnknownOption(Schema.Struct({ incidents: Schema.Array(Incident) }))
const decodeRecord = Schema.decodeUnknownOption(IncidentRecord)
const decodeSet = Schema.decodeUnknownOption(EvidenceSet)

const listed = (path: string) =>
  fetch(path)
    .then((response) => (response.ok ? response.json() : undefined))
    .then((body) => (body === undefined ? undefined : Option.getOrUndefined(decodeIncidents(body))?.incidents))
    .catch(() => undefined)

/** A change to an incident: the incident as it now is, or why not, in the server's words where it gave them. */
const incidentWrite = (method: "POST" | "DELETE", path: string, body?: unknown): Promise<Incident | string> =>
  fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
    .then((response) =>
      response
        .json()
        .catch(() => undefined)
        .then((answer) =>
          response.ok
            ? (Option.getOrUndefined(decodeIncident(answer)) ??
              "The incident came back in a shape the page cannot read.")
            : (Option.getOrUndefined(decodeMessage(answer))?.message ??
              `The incident could not be changed (${response.status}).`),
        ),
    )
    .catch(() => "Estate could not be reached.")

type IncidentActions = Pick<
  Actions,
  | "incidents"
  | "allIncidents"
  | "incident"
  | "openIncident"
  | "linkIncident"
  | "unlinkIncident"
  | "closeIncident"
  | "addIncidentNote"
  | "addIncidentHappened"
  | "keepIncidentEvidence"
  | "addIncidentService"
  | "removeIncidentNote"
  | "dismissIncident"
  | "raiseIncident"
  | "include"
  | "removeIncluded"
>

export const incidentsOn = (environment: () => string): IncidentActions => ({
  incidents: () => listed("/api/incidents"),
  allIncidents: () => listed("/api/incidents?closed=true"),
  incident: (id) =>
    fetch(`/api/incidents/${encodeURIComponent(id)}`)
      .then((response): Promise<IncidentRecord | "none" | undefined> => {
        if (response.status === 404) return Promise.resolve("none")
        if (!response.ok) return Promise.resolve(undefined)
        return response.json().then((body) => Option.getOrUndefined(decodeRecord(body)))
      })
      .catch(() => undefined),
  openIncident: (title, alert) => incidentWrite("POST", "/api/incidents", { title, environment: environment(), alert }),
  linkIncident: (id, alert, env = environment()) =>
    incidentWrite("POST", `/api/incidents/${encodeURIComponent(id)}/firings`, { environment: env, alert }),
  unlinkIncident: (id, env, alert, startsAt) =>
    incidentWrite(
      "DELETE",
      `/api/incidents/${encodeURIComponent(id)}/firings?env=${encodeURIComponent(env)}&alert=${encodeURIComponent(alert)}&at=${encodeURIComponent(startsAt)}`,
    ),
  closeIncident: (id, how) => incidentWrite("POST", `/api/incidents/${encodeURIComponent(id)}/close`, { how }),
  addIncidentNote: (id, text) => incidentWrite("POST", `/api/incidents/${encodeURIComponent(id)}/notes`, { text }),
  addIncidentHappened: (id, text, at) =>
    fetch(`/api/incidents/${encodeURIComponent(id)}/happened`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(at === undefined ? { text } : { text, at }),
    })
      .then<true | string>((response) => (response.ok ? true : refusalOf(response, "What happened could not be kept")))
      .catch(() => "Estate could not be reached."),
  keepIncidentEvidence: (id) =>
    fetch(`/api/incidents/${encodeURIComponent(id)}/evidence`, { method: "POST" })
      .then<true | string>((response) => (response.ok ? true : refusalOf(response, "The evidence could not be kept")))
      .catch(() => "Estate could not be reached."),
  addIncidentService: (id, service) =>
    incidentWrite("POST", `/api/incidents/${encodeURIComponent(id)}/services`, { service }),
  removeIncidentNote: (id, note) =>
    incidentWrite("DELETE", `/api/incidents/${encodeURIComponent(id)}/notes/${encodeURIComponent(note)}`),
  dismissIncident: (id, alert, env = environment()) =>
    incidentWrite("POST", `/api/incidents/${encodeURIComponent(id)}/dismissed`, { environment: env, alert }),
  raiseIncident: (id) => incidentWrite("POST", `/api/incidents/${encodeURIComponent(id)}/raise`),
  include: (id, what) =>
    fetch(`/api/incidents/${encodeURIComponent(id)}/included`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(what),
    })
      .then(
        (response): Promise<EvidenceSet | string> =>
          response.ok
            ? response
                .json()
                .then((body) => Option.getOrUndefined(decodeSet(body)) ?? "What was kept came back unreadable.")
            : refusalOf(response, "It could not be included"),
      )
      .catch(() => "Estate could not be reached."),
  removeIncluded: (id, set) =>
    fetch(`/api/incidents/${encodeURIComponent(id)}/included/${encodeURIComponent(set)}`, { method: "DELETE" })
      .then<true | string>((response) => (response.ok ? true : refusalOf(response, "It could not be removed")))
      .catch(() => "Estate could not be reached."),
})
