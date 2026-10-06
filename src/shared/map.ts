/** The catalog's map: what is drawn, how the nodes are joined, and when it draws a node a category instead. */
import { Schema } from "effect"

const optional = Schema.optionalKey

const MapNode = Schema.Struct({
  id: Schema.String,
  service: optional(Schema.String),
  store: optional(Schema.String),
  title: optional(Schema.String),
  kind: optional(Schema.Literals(["service", "store", "external"])),
})

const MapEdge = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  label: optional(Schema.String),
  rate: optional(Schema.String),
  alert: optional(Schema.String),
})

export const CatalogMap = Schema.Struct({
  nodes: Schema.Array(MapNode),
  edges: Schema.Array(MapEdge),
  /** Past how many nodes the map draws a node a category: 12 unless set, or never. */
  collapse: optional(Schema.Union([Schema.Number, Schema.Literal("never")])),
})
