/** Where the page is: the path names the page, `?env=` the environment. */
export type Page =
  | { readonly page: "overview" }
  | { readonly page: "service"; readonly name: string }
  | { readonly page: "store"; readonly name: string }
  | { readonly page: "job"; readonly name: string }
  | { readonly page: "agent"; readonly name: string }
  | { readonly page: "deploys" }
  | { readonly page: "alerts" }
  | { readonly page: "alert"; readonly id: string }
  | { readonly page: "kiosk"; readonly team?: string; readonly category?: string }
  | { readonly page: "missing" }

/** The pages a path names by its first part, each given the part after it. */
const pagesNamed: ReadonlyMap<string, (name: string) => Page> = new Map<string, (name: string) => Page>([
  ["alerts", (id) => ({ page: "alert", id })],
  ["services", (name) => ({ page: "service", name })],
  ["stores", (name) => ({ page: "store", name })],
  ["jobs", (name) => ({ page: "job", name })],
  ["agents", (name) => ({ page: "agent", name })],
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
  if (pathname === "/kiosk") {
    const params = new URLSearchParams(search)
    const team = params.get("team")
    const category = params.get("category")
    return { page: "kiosk", ...(team === null ? {} : { team }), ...(category === null ? {} : { category }) }
  }
  const [, kind = "", name] = /^\/(\w+)\/([^/]+)$/.exec(pathname) ?? []
  const named = pagesNamed.get(kind)
  const decoded = name === undefined ? undefined : decodedOf(name)
  return named === undefined || decoded === undefined ? { page: "missing" } : named(decoded)
}

export const pathOf = (page: Page): string => {
  switch (page.page) {
    case "overview":
      return "/"
    case "service":
      return `/services/${encodeURIComponent(page.name)}`
    case "store":
      return `/stores/${encodeURIComponent(page.name)}`
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
