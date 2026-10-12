/** Where a timeline is exported from: a firing's in the page's environment, or an incident's, which spans them. */
export type Exported = { readonly alert: string; readonly startsAt: string } | { readonly incident: string }

export const timelinePath = (of: Exported, environment: string, format: "md" | "json") =>
  "incident" in of
    ? `/api/incidents/${encodeURIComponent(of.incident)}/timeline?format=${format}`
    : `/api/firings/${encodeURIComponent(of.alert)}/timeline?env=${encodeURIComponent(environment)}&at=${encodeURIComponent(of.startsAt)}&format=${format}`
