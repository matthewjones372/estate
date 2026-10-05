/** Where the page is: the path names the page, `?env=` the environment. */
export type Page =
  | { readonly page: "overview" }
  | { readonly page: "service"; readonly name: string }
  | { readonly page: "store"; readonly name: string }
  | { readonly page: "deploys" }
  | { readonly page: "alerts" }
  | { readonly page: "alert"; readonly id: string }
  | { readonly page: "kiosk"; readonly team?: string; readonly category?: string }
  | { readonly page: "missing" }

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
  const alert = /^\/alerts\/([^/]+)$/.exec(pathname)?.[1]
  if (alert !== undefined) return { page: "alert", id: decodeURIComponent(alert) }
  const service = /^\/services\/([^/]+)$/.exec(pathname)?.[1]
  if (service !== undefined) return { page: "service", name: decodeURIComponent(service) }
  const store = /^\/stores\/([^/]+)$/.exec(pathname)?.[1]
  return store === undefined ? { page: "missing" } : { page: "store", name: decodeURIComponent(store) }
}

export const pathOf = (page: Page): string => {
  switch (page.page) {
    case "overview":
      return "/"
    case "service":
      return `/services/${encodeURIComponent(page.name)}`
    case "store":
      return `/stores/${encodeURIComponent(page.name)}`
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
