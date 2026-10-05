/** A catalog `incident` / `raise-incident` link: filled for an alert, opened out — Estate does not create incidents. */
export type NamedLink = { readonly name: string; readonly url: string }

/** The configured raise-incident link, if the catalog names one. */
export const incidentOf = (links: ReadonlyArray<NamedLink> | undefined): NamedLink | undefined =>
  links?.find((link) => link.name === "incident" || link.name === "raise-incident")

/**
 * Fill `{alert}` and `{summary}` left after the catalog's env/service fill. Empty when not given (service context).
 * Encoded so a title with spaces is safe in a query.
 */
export const fillIncident = (
  url: string,
  values: { readonly alert?: string; readonly summary?: string } = {},
): string =>
  url.replace(/\{(alert|summary)\}/g, (_, name: "alert" | "summary") => encodeURIComponent(values[name] ?? ""))
