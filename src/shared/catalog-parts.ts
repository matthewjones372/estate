/** What the catalog's entries share: where something runs on Kubernetes, by namespace and workloads. */
import { Schema } from "effect"

const Workload = Schema.Struct({
  kind: Schema.Literals(["Deployment", "StatefulSet", "DaemonSet"]),
  name: Schema.String,
})

export const Kubernetes = Schema.Struct({ namespace: Schema.String, workloads: Schema.Array(Workload) })
