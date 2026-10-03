/** Decoding with every mistake named and placed, for the catalog, the settings and anything else people write. */
import { Result, Schema, SchemaIssue } from "effect"

export interface Mistake {
  readonly at: string
  readonly message: string
}

type Segment = PropertyKey | { readonly key: PropertyKey }

const where = (path: ReadonlyArray<Segment>): string =>
  path.reduce<string>((text, segment) => {
    const key = typeof segment === "object" ? segment.key : segment
    return typeof key === "number" ? `${text}[${key}]` : text === "" ? String(key) : `${text}.${String(key)}`
  }, "")

const formatter = SchemaIssue.makeFormatterStandardSchemaV1()

export const checkShape = <S extends Schema.Decoder<unknown>>(
  schema: S,
  input: unknown,
): Result.Result<S["Type"], ReadonlyArray<Mistake>> => {
  const decoded = Schema.decodeUnknownResult(schema)(input, { errors: "all", onExcessProperty: "error" })
  if (Result.isSuccess(decoded)) return Result.succeed(decoded.success)
  const { issues } = formatter(decoded.failure.issue)
  return Result.fail(issues.map((issue) => ({ at: where(issue.path ?? []), message: issue.message })))
}
