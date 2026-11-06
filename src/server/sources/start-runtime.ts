/**
 * Runtime and deploy readers for ECS and Cloud Run, started per environment.
 */
import { Effect } from "effect"
import type { Service, StandaloneJob } from "../../shared/catalog"
import type { AwsJson } from "../aws/json"
import type { GcpJson } from "../gcp/json"
import type { Sources } from "../settings"
import type { Estate } from "../state"
import { readCloudRunDeploys, readCloudRunWorkloads } from "./cloud-run"
import { readEcsDeploys, readEcsWorkloads } from "./ecs"
import { everyOf } from "./every"
import { deploysOf } from "./ports"
import { type Failure, runSource } from "./run"
import { cloudRunJobs, ecsJobs, withJobs } from "./standalone"

type ReadServices = (environment: string) => Effect.Effect<ReadonlyArray<Service>, never, Estate>
type ReadJobs = (environment: string) => Effect.Effect<ReadonlyArray<StandaloneJob>, never, Estate>

export const ecsReader = (
  section: Sources,
  ecs: AwsJson,
  environment: string,
  servicesIn: ReadServices,
  jobsHere: ReadJobs,
) => {
  const images = new Map<string, string | undefined>()
  const read = <A>(part: (services: ReadonlyArray<Service>) => Effect.Effect<A, Failure, Estate>) =>
    Effect.flatMap(servicesIn(environment), part)

  return Effect.all(
    [
      runSource(
        environment,
        "cluster",
        everyOf(section, "cluster"),
        read((services) =>
          Effect.all([
            readEcsWorkloads(ecs, services),
            Effect.flatMap(jobsHere(environment), (jobs) => ecsJobs(ecs, jobs)),
          ]).pipe(Effect.map(([workloads, jobs]) => withJobs(workloads, jobs))),
        ),
      ),
      ...(deploysOf(section) === "ecs"
        ? [
            runSource(
              environment,
              "deploys",
              everyOf(section, "deploys"),
              read((services) => readEcsDeploys(ecs, services, images)),
            ),
          ]
        : []),
    ],
    { concurrency: "unbounded" },
  ).pipe(Effect.andThen(Effect.never))
}

export const cloudRunReader = (
  section: Sources,
  gcp: NonNullable<Sources["gcp"]>,
  gcpJson: GcpJson,
  environment: string,
  servicesIn: ReadServices,
  jobsHere: ReadJobs,
) => {
  const read = <A>(part: (services: ReadonlyArray<Service>) => Effect.Effect<A, Failure, Estate>) =>
    Effect.flatMap(servicesIn(environment), part)

  return Effect.all(
    [
      runSource(
        environment,
        "cluster",
        everyOf(section, "cluster"),
        read((services) =>
          Effect.all([
            readCloudRunWorkloads(gcpJson, gcp.project, gcp.region, services),
            Effect.flatMap(jobsHere(environment), (jobs) => cloudRunJobs(gcpJson, gcp.project, gcp.region, jobs)),
          ]).pipe(Effect.map(([workloads, jobs]) => withJobs(workloads, jobs))),
        ),
      ),
      ...(deploysOf(section) === "cloud-run"
        ? [
            runSource(
              environment,
              "deploys",
              everyOf(section, "deploys"),
              read((services) => readCloudRunDeploys(gcpJson, gcp.project, gcp.region, services)),
            ),
          ]
        : []),
    ],
    { concurrency: "unbounded" },
  ).pipe(Effect.andThen(Effect.never))
}
