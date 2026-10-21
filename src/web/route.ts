/** The windows a service's errors are shown over. */
export const errorRanges = ["1h", "6h", "24h"] as const
export type ErrorRange = (typeof errorRanges)[number]

/** Which of a service's logs its page shows: the live lines, or the errors over a range. */
export interface LogsShown {
  readonly view: "live" | "errors"
  readonly range: ErrorRange
}

/** Where the page is: the path names the page, `?env=` the environment, and a service's `?logs=&range=` its logs. */
export type Page =
  | { readonly page: "overview" }
  | { readonly page: "service"; readonly name: string; readonly logs?: LogsShown }
  /** A store, and on a Kafka store a message followed by its trace (spec 0057). */
  | { readonly page: "store"; readonly name: string; readonly message?: string }
  | { readonly page: "job"; readonly name: string }
  | { readonly page: "agent"; readonly name: string }
  | { readonly page: "deploys" }
  | { readonly page: "alerts" }
  | { readonly page: "alert"; readonly id: string }
  /** One past firing of an alert: its id, and when the firing started. */
  | { readonly page: "firing"; readonly id: string; readonly at: string }
  /** Every incident kept, open and closed. */
  | { readonly page: "incidents" }
  /** An incident: the firings a person linked as one problem. */
  | { readonly page: "incident"; readonly id: string }
  /** One trace, measured as the journey it was opened from, where there is one (spec 0046). */
  | { readonly page: "trace"; readonly id: string; readonly journey?: string }
  | { readonly page: "kiosk"; readonly team?: string; readonly category?: string }
  | { readonly page: "missing" }

/** The pages a path names by its first part, each given the part after it. */
const pagesNamed: ReadonlyMap<string, (name: string) => Page> = new Map<string, (name: string) => Page>([
  ["alerts", (id) => ({ page: "alert", id })],
  ["services", (name) => ({ page: "service", name })],
  ["stores", (name) => ({ page: "store", name })],
  ["jobs", (name) => ({ page: "job", name })],
  ["agents", (name) => ({ page: "agent", name })],
  ["incidents", (id) => ({ page: "incident", id })],
  ["traces", (id) => ({ page: "trace", id })],
])

/** A path's part as it was before it was escaped; one that was never validly escaped names no page. */
const decodedOf = (part: string): string | undefined => {
  try {
    return decodeURIComponent(part)
  } catch {
    return undefined
  }
}

export const pageOf = (pathname: string, search = ""): Page => {
  if (pathname === "/" || pathname === "") return { page: "overview" }
  if (pathname === "/deploys") return { page: "deploys" }
  if (pathname === "/alerts") return { page: "alerts" }
  if (pathname === "/incidents") return { page: "incidents" }
  if (pathname === "/kiosk") {
    const params = new URLSearchParams(search)
    const team = params.get("team")
    const category = params.get("category")
    return { page: "kiosk", ...(team === null ? {} : { team }), ...(category === null ? {} : { category }) }
  }
  const [, id = "", at = ""] = /^\/alerts\/([^/]+)\/([^/]+)$/.exec(pathname) ?? []
  if (id !== "") {
    const [decodedId, decodedAt] = [decodedOf(id), decodedOf(at)]
    return decodedId === undefined || decodedAt === undefined
      ? { page: "missing" }
      : { page: "firing", id: decodedId, at: decodedAt }
  }
  const [, store = "", message = ""] = /^\/stores\/([^/]+)\/messages\/([^/]+)$/.exec(pathname) ?? []
  if (store !== "") {
    const [decodedStore, decodedMessage] = [decodedOf(store), decodedOf(message)]
    return decodedStore === undefined || decodedMessage === undefined
      ? { page: "missing" }
      : { page: "store", name: decodedStore, message: decodedMessage }
  }
  const [, journey = "", trace = ""] = /^\/journeys\/([^/]+)\/([^/]+)$/.exec(pathname) ?? []
  if (journey !== "") {
    const [decodedJourney, decodedTrace] = [decodedOf(journey), decodedOf(trace)]
    return decodedJourney === undefined || decodedTrace === undefined
      ? { page: "missing" }
      : { page: "trace", id: decodedTrace, journey: decodedJourney }
  }
  const [, kind = "", name] = /^\/(\w+)\/([^/]+)$/.exec(pathname) ?? []
  const named = pagesNamed.get(kind)
  const decoded = name === undefined ? undefined : decodedOf(name)
  if (named === undefined || decoded === undefined) return { page: "missing" }
  const found = named(decoded)
  if (found.page !== "service") return found
  const logs = logsOf(new URLSearchParams(search))
  return logs === undefined ? found : { ...found, logs }
}

/** The logs an address asks for; undefined when it asks for none Estate knows, so the page shows its default. */
const logsOf = (params: URLSearchParams): LogsShown | undefined => {
  if (params.get("logs") !== "errors") return undefined
  const range = errorRanges.find((each) => each === params.get("range"))
  return { view: "errors", range: range ?? "1h" }
}

/** A service page's `?logs=&range=`, leaving out what it shows anyway. */
const logsQuery = (logs: LogsShown | undefined): string => {
  if (logs === undefined || logs.view === "live") return ""
  return logs.range === "1h" ? "?logs=errors" : `?logs=errors&range=${logs.range}`
}

/** The browser's title for a page: what it shows first, so a tab, a history entry or a screen reader says which. */
export const titleOf = (page: Page): string => {
  const named = (title: string) => `${title} · Estate`
  switch (page.page) {
    case "overview":
      return "Estate"
    case "store":
      return named(page.message === undefined ? page.name : `A message through ${page.name}`)
    case "service":
    case "job":
    case "agent":
      return named(page.name)
    case "deploys":
      return named("Deploys")
    case "alerts":
      return named("Alerts")
    case "alert":
      return named("Alert")
    case "firing":
      return named("Past firing")
    case "incidents":
      return named("Incidents")
    case "incident":
      return named("Incident")
    case "trace":
      return named("Trace")
    case "kiosk":
      return named("On a screen")
    case "missing":
      return named("No such page")
  }
}

export const pathOf = (page: Page): string => {
  switch (page.page) {
    case "overview":
      return "/"
    case "service":
      return `/services/${encodeURIComponent(page.name)}${logsQuery(page.logs)}`
    case "store":
      return page.message === undefined
        ? `/stores/${encodeURIComponent(page.name)}`
        : `/stores/${encodeURIComponent(page.name)}/messages/${encodeURIComponent(page.message)}`
    case "job":
      return `/jobs/${encodeURIComponent(page.name)}`
    case "agent":
      return `/agents/${encodeURIComponent(page.name)}`
    case "deploys":
      return "/deploys"
    case "alerts":
      return "/alerts"
    case "alert":
      return `/alerts/${encodeURIComponent(page.id)}`
    case "firing":
      // A time's colons are left as they are, so a link pasted into a review reads as the time it is.
      return `/alerts/${encodeURIComponent(page.id)}/${encodeURIComponent(page.at).replaceAll("%3A", ":")}`
    case "incidents":
      return "/incidents"
    case "incident":
      return `/incidents/${encodeURIComponent(page.id)}`
    case "trace":
      return page.journey === undefined
        ? `/traces/${encodeURIComponent(page.id)}`
        : `/journeys/${encodeURIComponent(page.journey)}/${encodeURIComponent(page.id)}`
    case "kiosk":
      return "/kiosk"
    case "missing":
      return "/"
  }
}

/** The environment to show: the one in the address, the one last chosen here, or the catalog's first. */
export const chooseEnvironment = (
  inAddress: string | null,
  remembered: string | null,
  known: ReadonlyArray<string>,
): string | undefined => {
  for (const candidate of [inAddress, remembered]) {
    if (candidate !== null && (known.length === 0 || known.includes(candidate))) return candidate
  }
  return known[0]
}

/** Where a past firing's page is: its alert's id and when it started. */
export const firingPath = (id: string, at: string) => pathOf({ page: "firing", id, at })
