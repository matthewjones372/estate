/** The catalog: an estate's environments, services, vitals and map, as its owner writes it in `catalog.yaml`. */
import { Schema } from "effect"

const optional = Schema.optionalKey

const Environment = Schema.Struct({
  name: Schema.String,
  title: optional(Schema.String),
  sources: Schema.String,
})

const Workload = Schema.Struct({
  kind: Schema.Literals(["Deployment", "StatefulSet", "DaemonSet"]),
  name: Schema.String,
})

export const Service = Schema.Struct({
  name: Schema.String,
  description: optional(Schema.String),
  owner: optional(Schema.String),
  repository: optional(Schema.String),
  build: optional(Schema.Struct({ workflow: Schema.String, branch: optional(Schema.String) })),
  runbook: optional(Schema.String),
  environments: Schema.Array(Schema.String),
  kubernetes: optional(Schema.Struct({ namespace: Schema.String, workloads: Schema.Array(Workload) })),
  deploy: optional(
    Schema.Struct({
      flux: Schema.Struct({
        kustomization: Schema.String,
        namespace: optional(Schema.String),
        imagePolicy: optional(Schema.String),
      }),
    }),
  ),
  load: optional(
    Schema.Struct({ requests: optional(Schema.String), errors: optional(Schema.String), p99: optional(Schema.String) }),
  ),
  links: optional(Schema.Record(Schema.String, Schema.String)),
  debug: optional(Schema.Struct({ configMap: Schema.String, key: Schema.String, levels: Schema.Array(Schema.String) })),
  jobs: optional(Schema.Array(Schema.Struct({ kind: Schema.Literals(["CronJob", "Job"]), name: Schema.String }))),
  stats: optional(
    Schema.Struct({
      preset: optional(Schema.Literals(["jvm", "process", "container"])),
      selector: optional(Schema.String),
      extra: optional(
        Schema.Array(Schema.Struct({ title: Schema.String, query: Schema.String, unit: optional(Schema.String) })),
      ),
    }),
  ),
})
export type Service = typeof Service.Type

const Vital = Schema.Struct({ title: Schema.String, query: Schema.String, unit: optional(Schema.String) })

const MapNode = Schema.Struct({
  id: Schema.String,
  service: optional(Schema.String),
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

export const Catalog = Schema.Struct({
  environments: Schema.Array(Environment),
  services: Schema.Array(Service),
  vitals: optional(Schema.Array(Vital)),
  map: optional(Schema.Struct({ nodes: Schema.Array(MapNode), edges: Schema.Array(MapEdge) })),
})
export type Catalog = typeof Catalog.Type
