/** Why the server refused a call, in its words where it gave them. */
import { Option, Schema } from "effect"

export const decodeMessage = Schema.decodeUnknownOption(Schema.Struct({ message: Schema.String }))

/** Why a call was refused, in the server's words where it gave them, else `what` and its status. */
export const refusalOf = (response: Response, what = "Ask AI could not answer"): Promise<string> =>
  response
    .json()
    .then((body) => Option.getOrUndefined(decodeMessage(body))?.message)
    .catch(() => undefined)
    .then((message) => message ?? `${what} (${response.status}).`)
