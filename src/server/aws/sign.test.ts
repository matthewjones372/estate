import { describe, expect, test } from "bun:test"
import { Redacted } from "effect"
import { type Credentials, type Signable, sign } from "./sign"

// AWS's SigV4 test suite, as aws-c-auth keeps it (tests/aws-signing-test-suite/v4): each request, signed with the
// suite's example keys for us-east-1's "service" at 2015-08-30T12:36:00Z, and the Authorization AWS expects.
const keys: Credentials = {
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: Redacted.make("wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY"),
}
const at = Date.parse("2015-08-30T12:36:00Z")
const scope = { region: "us-east-1", service: "service" }
const credential = "Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request"

const get = (path: string, headers: Record<string, string> = {}): Signable => ({
  method: "GET",
  url: `https://example.amazonaws.com${path}`,
  headers,
})

const suite: ReadonlyArray<readonly [string, Signable, string, string, boolean?]> = [
  ["get-vanilla", get("/"), "host;x-amz-date", "5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31"],
  [
    "get-vanilla-query-order-key-case",
    get("/?Param2=value2&Param1=value1"),
    "host;x-amz-date",
    "b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500",
  ],
  [
    "get-vanilla-utf8-query",
    get("/?ሴ=bar"),
    "host;x-amz-date",
    "2cdec8eed098649ff3a119c94853b13c643bcf08f8b0a1d91e12c9027818dd04",
  ],
  [
    "get-space-normalized",
    get("/example space/"),
    "host;x-amz-date",
    "652487583200325589f1fba4c7e578f72c47cb61beeca81406b39ddec1366741",
  ],
  [
    "get-header-value-trim",
    get("/", { "My-Header1": " value1", "My-Header2": ' "a   b   c"' }),
    "host;my-header1;my-header2;x-amz-date",
    "acc3ed3afb60bb290fc8d2dd0098b9911fcaa05412b367055dee359757a9c736",
  ],
  [
    "post-x-www-form-urlencoded",
    {
      method: "POST",
      url: "https://example.amazonaws.com/",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": "13" },
      body: "Param1=value1",
    },
    "content-length;content-type;host;x-amz-content-sha256;x-amz-date",
    "d3875051da38690788ef43de4db0d8f280229d82040bfac253562e56c3f20e0b",
    true,
  ],
]

describe("SigV4", () => {
  for (const [name, request, signed, signature, signBody] of suite) {
    test(`signs ${name} as AWS's suite does`, () => {
      const out = sign(request, keys, { ...scope, signBody: signBody === true }, at)
      expect(out.headers["authorization"]).toBe(
        `AWS4-HMAC-SHA256 ${credential}, SignedHeaders=${signed}, Signature=${signature}`,
      )
      expect(out.headers["x-amz-date"]).toBe("20150830T123600Z")
    })
  }

  test("signs get-vanilla-with-session-token, sending the token", () => {
    const token = "6e86291e8372ff2a2260956d9b8aae1d763fbf315fa00fa31553b73ebf194267"
    const out = sign(get("/"), { ...keys, sessionToken: Redacted.make(token) }, scope, at)
    expect(out.headers["x-amz-security-token"]).toBe(token)
    expect(out.headers["authorization"]).toBe(
      `AWS4-HMAC-SHA256 ${credential}, SignedHeaders=host;x-amz-date;x-amz-security-token, Signature=07ec1639c89043aa0e3e2de82b96708f198cceab042d4a97044c66dd9f74e7f8`,
    )
  })

  test("resolves . and .. in the path, as the suite's normalised requests ask", () => {
    const plain = sign(get("/"), keys, scope, at).headers["authorization"]
    expect(sign(get("/example/.."), keys, scope, at).headers["authorization"]).toBe(plain)
    expect(sign(get("/./"), keys, scope, at).headers["authorization"]).toBe(plain)
  })
})
