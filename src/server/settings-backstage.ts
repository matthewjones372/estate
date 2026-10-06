/** Where Backstage is, for discovering services from its catalog (spec 0033), with a static token to read it. */
import { Schema } from "effect"
import { Secret } from "./secret"

export const Backstage = Schema.Struct({ url: Schema.String, token: Schema.optionalKey(Secret) })
export type Backstage = typeof Backstage.Type
