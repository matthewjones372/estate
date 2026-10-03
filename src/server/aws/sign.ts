/**
 * AWS Signature Version 4, for AWS's JSON APIs: the request made canonical, hashed, and signed with a key derived from
 * the secret, the day, the region and the service. Checked against AWS's own test suite.
 */
import { createHash, createHmac } from "node:crypto"
import { Redacted } from "effect"

export interface Credentials {
  readonly accessKeyId: string
  readonly secretAccessKey: Redacted.Redacted<string>
  readonly sessionToken?: Redacted.Redacted<string>
  /** When they stop working, in milliseconds; never, for keys from the environment. */
  readonly expiresAt?: number
}

export interface Signable {
  readonly method: string
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly body?: string
}

export interface Scope {
  readonly region: string
  readonly service: string
  /** Also sign the body's hash as a header, as S3 and some others ask. */
  readonly signBody?: boolean
}

const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex")
const hmac = (key: string | Buffer, text: string) => createHmac("sha256", key).update(text, "utf8").digest()

/** RFC 3986's encoding, which leaves only letters, digits and `-_.~` as they are. */
const encode = (text: string) =>
  encodeURIComponent(text).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)

/** The path with `.` and `..` resolved and empty segments dropped, each segment encoded once. */
const canonicalPath = (pathname: string): string => {
  const segments = pathname.split("/").reduce<ReadonlyArray<string>>((kept, segment) => {
    if (segment === "" || segment === ".") return kept
    return segment === ".." ? kept.slice(0, -1) : [...kept, encode(decodeURIComponent(segment))]
  }, [])
  const trailing = pathname.endsWith("/") && segments.length > 0 ? "/" : ""
  return `/${segments.join("/")}${trailing}`
}

const canonicalQuery = (search: URLSearchParams): string =>
  [...search]
    .map(([name, value]) => [encode(name), encode(value)] as const)
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : x > y ? 1 : 0) : a < b ? -1 : 1))
    .map(([name, value]) => `${name}=${value}`)
    .join("&")

/** `20150830T123600Z`, as AWS writes a time. */
const amzDate = (at: number) =>
  new Date(at)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "")

/** The request with its `x-amz-date`, its session token if any, and its `authorization`, signed at `at`. */
export const sign = (request: Signable, credentials: Credentials, scope: Scope, at: number): Signable => {
  const url = new URL(request.url)
  const date = amzDate(at)
  const day = date.slice(0, 8)
  const payload = hash(request.body ?? "")
  const token = credentials.sessionToken === undefined ? undefined : Redacted.value(credentials.sessionToken)
  const added: Record<string, string> = {
    "x-amz-date": date,
    ...(token === undefined ? {} : { "x-amz-security-token": token }),
    ...(scope.signBody === true ? { "x-amz-content-sha256": payload } : {}),
  }
  const headers = Object.entries({ ...request.headers, host: url.host, ...added })
    .map(([name, value]) => [name.toLowerCase(), value.trim().replace(/\s+/g, " ")] as const)
    .sort(([a], [b]) => (a < b ? -1 : 1))
  const signed = headers.map(([name]) => name).join(";")
  const canonical = [
    request.method.toUpperCase(),
    canonicalPath(url.pathname),
    canonicalQuery(url.searchParams),
    ...headers.map(([name, value]) => `${name}:${value}`),
    "",
    signed,
    payload,
  ].join("\n")
  const credentialScope = `${day}/${scope.region}/${scope.service}/aws4_request`
  const toSign = ["AWS4-HMAC-SHA256", date, credentialScope, hash(canonical)].join("\n")
  const key = [day, scope.region, scope.service, "aws4_request"].reduce<string | Buffer>(
    (derived, part) => hmac(derived, part),
    `AWS4${Redacted.value(credentials.secretAccessKey)}`,
  )
  const signature = createHmac("sha256", key).update(toSign, "utf8").digest("hex")
  return {
    ...request,
    headers: {
      ...request.headers,
      ...added,
      authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signed}, Signature=${signature}`,
    },
  }
}
