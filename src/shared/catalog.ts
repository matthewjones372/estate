/** The catalog: an estate's environments, services, vitals and map, as its owner writes it in `catalog.yaml`. */
import { Schema } from "effect"

const optional = Schema.optionalKey

const Environment = Schema.Struct({
  name: Schema.String,
  title: optional(Schema.String),
  sources: Schema.String,
  /** Values a link may name as `{name}`, as this environment has them: its Grafana's address, say. */
  values: optional(Schema.Record(Schema.String, Schema.String)),
})
export type Environment = typeof Environment.Type

const Workload = Schema.Struct({
  kind: Schema.Literals(["Deployment", "StatefulSet", "DaemonSet"]),
  name: Schema.String,
})

const Kubernetes = Schema.Struct({ namespace: Schema.String, workloads: Schema.Array(Workload) })
const Workflow = Schema.Struct({ workflow: Schema.String, branch: optional(Schema.String) })
const Pipelines = Schema.Struct({ project: Schema.String, ref: optional(Schema.String) })
const JenkinsJob = Schema.Struct({ job: Schema.String, branch: optional(Schema.String) })
const TeamCityBuildType = Schema.Struct({ buildType: Schema.String, branch: optional(Schema.String) })
const HarnessPipeline = Schema.Struct({ org: Schema.String, project: Schema.String, pipeline: Schema.String })
/** A Harness CD pipeline, the service it deploys by Harness's identifier, and the environment's, where they differ. */
const HarnessDeploy = Schema.Struct({
  org: Schema.String,
  project: Schema.String,
  pipeline: Schema.String,
  service: optional(Schema.String),
  environment: optional(Schema.String),
})

export const Service = Schema.Struct({
  name: Schema.String,
  description: optional(Schema.String),
  owner: optional(Schema.String),
  repository: optional(Schema.String),
  /**
   * Its builds: `{ github: { workflow, branch } }` or the workflow alone, meaning GitHub Actions; or
   * `{ gitlab: { project, ref } }`; `{ jenkins: { job, branch } }`, the job by its folders and a multibranch job's
   * branch; `{ teamcity: { buildType, branch } }`; or `{ harness: { org, project, pipeline } }`.
   */
  build: optional(
    Schema.Union([
      Workflow,
      Schema.Struct({ github: Workflow }),
      Schema.Struct({ gitlab: Pipelines }),
      Schema.Struct({ jenkins: JenkinsJob }),
      Schema.Struct({ teamcity: TeamCityBuildType }),
      Schema.Struct({ harness: HarnessPipeline }),
    ]),
  ),
  runbook: optional(Schema.String),
  environments: Schema.Array(Schema.String),
  /** What it runs on, by that runtime's own names: `{ kubernetes: { namespace, workloads } }` or `{ ecs: { cluster, service } }`. */
  runtime: optional(
    Schema.Struct({
      kubernetes: optional(Kubernetes),
      ecs: optional(Schema.Struct({ cluster: Schema.String, service: Schema.String })),
    }),
  ),
  /** The same as `runtime.kubernetes`, as catalogs written before `runtime` name it. */
  kubernetes: optional(Kubernetes),
  /**
   * What deploys it, by that tool's own names: Flux's Kustomization and ImagePolicy, Argo CD's Application, or Harness
   * CD's pipeline.
   */
  deploy: optional(
    Schema.Struct({
      flux: optional(
        Schema.Struct({
          kustomization: Schema.String,
          namespace: optional(Schema.String),
          imagePolicy: optional(Schema.String),
        }),
      ),
      argo: optional(Schema.Struct({ application: Schema.String })),
      harness: optional(HarnessDeploy),
    }),
  ),
  load: optional(
    Schema.Struct({ requests: optional(Schema.String), errors: optional(Schema.String), p99: optional(Schema.String) }),
  ),
  links: optional(Schema.Record(Schema.String, Schema.String)),
  debug: optional(Schema.Struct({ configMap: Schema.String, key: Schema.String, levels: Schema.Array(Schema.String) })),
  /** Its jobs: Kubernetes' CronJobs and Jobs by name, or ECS's scheduled tasks by their task family. */
  jobs: optional(
    Schema.Array(Schema.Struct({ kind: Schema.Literals(["CronJob", "Job", "ScheduledTask"]), name: Schema.String })),
  ),
  /** Where its lines are and which are errors; the defaults suit most services. */
  logs: optional(
    Schema.Struct({
      /**
       * Loki's stream selector, by default its namespace and its name as the app label; or Datadog's log query, by
       * default its name as the service tag and the environment's tags.
       */
      selector: optional(Schema.String),
      /** A pattern for an error, matched against a line's level, or its text if it has none, case aside. */
      errors: optional(Schema.String),
      /** Patterns for what must not leave Estate, each replaced with •••. */
      mask: optional(Schema.Array(Schema.String)),
      /** In Elasticsearch: the fields its lines carry, and the field its message is in. */
      elastic: optional(
        Schema.Struct({
          match: optional(Schema.Record(Schema.String, Schema.String)),
          message: optional(Schema.String),
        }),
      ),
    }),
  ),
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

/** Where a service runs on Kubernetes, however the catalog names it. */
export const kubernetesOf = (service: Service): typeof Kubernetes.Type | undefined =>
  service.runtime?.kubernetes ?? service.kubernetes

/** Where a service runs on ECS. */
export const ecsOf = (service: Service) => service.runtime?.ecs

/** The GitHub Actions workflow that builds a service, however the catalog names it. */
export const workflowOf = (service: Service): typeof Workflow.Type | undefined => {
  const { build } = service
  if (build === undefined || "gitlab" in build || "jenkins" in build || "teamcity" in build || "harness" in build)
    return undefined
  return "github" in build ? build.github : build
}

/** The Jenkins job that builds a service. */
export const jenkinsOf = (service: Service): typeof JenkinsJob.Type | undefined =>
  service.build !== undefined && "jenkins" in service.build ? service.build.jenkins : undefined

/** The Harness CI pipeline that builds a service. */
export const harnessBuildOf = (service: Service): typeof HarnessPipeline.Type | undefined =>
  service.build !== undefined && "harness" in service.build ? service.build.harness : undefined

/** The Harness CD pipeline that deploys a service. */
export const harnessDeployOf = (service: Service): typeof HarnessDeploy.Type | undefined => service.deploy?.harness

/** The TeamCity build type that builds a service. */
export const teamcityOf = (service: Service): typeof TeamCityBuildType.Type | undefined =>
  service.build !== undefined && "teamcity" in service.build ? service.build.teamcity : undefined

/** The GitLab project whose pipelines build a service. */
export const pipelinesOf = (service: Service): typeof Pipelines.Type | undefined =>
  service.build !== undefined && "gitlab" in service.build ? service.build.gitlab : undefined

const Vital = Schema.Struct({ title: Schema.String, query: Schema.String, unit: optional(Schema.String) })

/** A database, queue or cache, read through its exporter's series with the preset for its engine. */
export const Store = Schema.Struct({
  name: Schema.String,
  description: optional(Schema.String),
  environments: Schema.Array(Schema.String),
  engine: Schema.Literals(["postgres", "cnpg", "mysql", "redis", "kafka"]),
  /** The labels its exporter's series carry, as PromQL matchers. */
  selector: Schema.String,
  links: optional(Schema.Record(Schema.String, Schema.String)),
  extra: optional(
    Schema.Array(Schema.Struct({ title: Schema.String, query: Schema.String, unit: optional(Schema.String) })),
  ),
  /** The preset's thresholds, overridden for a store sized close to its limits on purpose. */
  attention: optional(Schema.Record(Schema.String, Schema.Number)),
})
export type Store = typeof Store.Type

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

export const Catalog = Schema.Struct({
  environments: Schema.Array(Environment),
  services: Schema.Array(Service),
  stores: optional(Schema.Array(Store)),
  vitals: optional(Schema.Array(Vital)),
  map: optional(Schema.Struct({ nodes: Schema.Array(MapNode), edges: Schema.Array(MapEdge) })),
})
export type Catalog = typeof Catalog.Type
