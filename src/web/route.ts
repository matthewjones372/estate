/** Where the page is: the path names the page, `?env=` the environment. */
export type Page =
  | { readonly page: "overview" }
  | { readonly page: "service"; readonly name: string }
  | { readonly page: "deploys" }
  | { readonly page: "alerts" }
  | { readonly page: "missing" }

export const pageOf = (pathname: string): Page => {
  if (pathname === "/" || pathname === "") return { page: "overview" }
  if (pathname === "/deploys") return { page: "deploys" }
  if (pathname === "/alerts") return { page: "alerts" }
  const service = /^\/services\/([^/]+)$/.exec(pathname)?.[1]
  return service === undefined ? { page: "missing" } : { page: "service", name: decodeURIComponent(service) }
}

export const pathOf = (page: Page): string => {
  switch (page.page) {
    case "overview":
      return "/"
    case "service":
      return `/services/${encodeURIComponent(page.name)}`
    case "deploys":
      return "/deploys"
    case "alerts":
      return "/alerts"
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
