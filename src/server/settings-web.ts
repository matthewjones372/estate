/**
 * `web:` in the settings: the other origins that may frame the pages, as a wall screen's dashboard does (spec 0056).
 * Each is added to the shell's `frame-ancestors 'self'`.
 */
import { Schema } from "effect"
import type { Mistake } from "../shared/shape"

export const WebSettings = Schema.Struct({ frameAncestors: Schema.optionalKey(Schema.Array(Schema.String)) })
type WebSettings = typeof WebSettings.Type

/** An origin and nothing else: a scheme, a host and a port if not the usual, with no path, query or wildcard. */
const isOrigin = (text: string) => {
  const url = URL.parse(text)
  return url !== null && (url.protocol === "https:" || url.protocol === "http:") && url.origin === text
}

export const frameAncestorsOf = (web: WebSettings | undefined): ReadonlyArray<string> => web?.frameAncestors ?? []

export const webMistakes = (web: WebSettings | undefined): ReadonlyArray<Mistake> =>
  frameAncestorsOf(web).flatMap((origin, index) =>
    isOrigin(origin)
      ? []
      : [
          {
            at: `web.frameAncestors[${index}]`,
            message: "needs an origin, like https://grafana.example.com: a scheme and a host, and a port if unusual",
          },
        ],
  )
