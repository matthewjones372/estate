/**
 * The address of a page's own state, such as which of a service's logs it shows: written beside the environment
 * already in it, so that a link pasted elsewhere opens the same thing.
 */

const withEnvironment = (path: string) => {
  const [pathname = path, search = ""] = path.split("?")
  const params = new URLSearchParams(search)
  const environment = new URLSearchParams(window.location.search).get("env")
  if (environment !== null) params.set("env", environment)
  const query = params.toString()
  return query === "" ? pathname : `${pathname}?${query}`
}

/** Goes to `path` on this page, adding to the history, and tells the page it moved as Back does. */
export const goTo = (path: string) => {
  window.history.pushState(null, "", withEnvironment(path))
  window.dispatchEvent(new PopStateEvent("popstate"))
}

/** Writes `path` in place of the address, without adding to the history or redrawing the page. */
export const replaceAddress = (path: string) => window.history.replaceState(null, "", withEnvironment(path))
