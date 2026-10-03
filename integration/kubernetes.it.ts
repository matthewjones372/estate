import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { readCluster } from "../src/server/sources/cluster"
import { switchOff, switchOn } from "../src/server/sources/debug"
import { readDeploys } from "../src/server/sources/flux"
import type { Service } from "../src/shared/catalog"
import { create, type K3s, setStatus, startK3s } from "./k3s"
import { eventually, real } from "./real"

const shop = "/api/v1/namespaces/shop"
const apps = "/apis/apps/v1/namespaces/shop"
const batch = "/apis/batch/v1/namespaces/shop"

// Checkout as a team runs it: a Deployment of two, its logging ConfigMap, a nightly CronJob, and Flux deploying it.
const checkout: Service = {
  name: "checkout",
  environments: ["production"],
  runtime: { kubernetes: { namespace: "shop", workloads: [{ kind: "Deployment", name: "checkout" }] } },
  debug: { configMap: "checkout-logging", key: "LOG_LEVEL", levels: ["INFO", "DEBUG"] },
  jobs: [{ kind: "CronJob", name: "nightly-report" }],
  deploy: { flux: { kustomization: "shop", imagePolicy: "checkout" } },
}
const search: Service = {
  name: "search",
  environments: ["production"],
  deploy: { flux: { kustomization: "shop", imagePolicy: "search" } },
}

const container = (image: string) => ({ containers: [{ name: "app", image }] })

let k3s: K3s

const podsOf = async (selector: string) =>
  (
    (await (await k3s.kube(`${shop}/pods?labelSelector=${selector}`)).json()) as {
      items: ReadonlyArray<{ metadata: { name: string } }>
    }
  ).items.map((pod) => pod.metadata.name)

beforeAll(async () => {
  k3s = await startK3s()
  await create(k3s, [{ metadata: { name: "shop" } }], () => "/api/v1/namespaces")
  // Estate's own RBAC, as deploy/ grants it: what it reads, and the ConfigMaps it may patch.
  const rbac = Bun.YAML.parse(await Bun.file(new URL("../deploy/rbac.yaml", import.meta.url)).text()) as Array<
    Record<string, unknown> & { kind: string; subjects?: ReadonlyArray<object> }
  >
  await create(
    k3s,
    rbac.map((object) =>
      object.subjects === undefined
        ? object
        : { ...object, subjects: object.subjects.map((subject) => ({ ...subject, namespace: "estate" })) },
    ),
    (object) =>
      `/apis/rbac.authorization.k8s.io/v1/${object["kind"] === "ClusterRole" ? "clusterroles" : "clusterrolebindings"}`,
  )
  await create(
    k3s,
    [
      {
        metadata: { name: "checkout" },
        spec: {
          replicas: 2,
          selector: { matchLabels: { app: "checkout" } },
          template: { metadata: { labels: { app: "checkout" } }, spec: container("example/checkout:1.4.2") },
        },
      },
    ],
    () => `${apps}/deployments`,
  )
  await create(
    k3s,
    [
      { metadata: { name: "checkout-logging" }, data: { LOG_LEVEL: "INFO" } },
      // Another team's pod, with a label checkout's selector does not have.
      { metadata: { name: "stray", labels: { app: "checkout-canary" } }, spec: container("example/canary:0.1") },
    ],
    (object) => (object["data"] === undefined ? `${shop}/pods` : `${shop}/configmaps`),
  )
})

afterAll(async () => {
  await k3s?.container.stop()
})

describe("a real Kubernetes", () => {
  test("gives a Deployment's pods, chosen by its selector, as the kubelet says they are", async () => {
    const [running, starting] = await eventually(
      () => podsOf("app=checkout"),
      (pods) => pods.length === 2,
    )
    const at = new Date().toISOString()
    await setStatus(k3s, `${shop}/pods/${running}`, {
      phase: "Running",
      startTime: at,
      conditions: [{ type: "Ready", status: "True", lastTransitionTime: at }],
      containerStatuses: [
        {
          name: "app",
          image: "example/checkout:1.4.2",
          imageID: "",
          ready: true,
          restartCount: 3,
          state: { running: {} },
        },
      ],
    })
    const workloads = await real(readCluster(k3s.cluster, [checkout]))
    const pods = [...(workloads.pods["checkout"] ?? [])].sort((a, b) => Number(b.ready) - Number(a.ready))
    expect(pods).toMatchObject([
      { name: running, phase: "Running", ready: true, restarts: 3, image: "example/checkout:1.4.2" },
      { name: starting, phase: "Pending", ready: false, restarts: 0 },
    ])
    expect(workloads.debug["checkout"]).toEqual({ level: "INFO", on: false })
    // Its CronJob is not made yet: that is said on its row, and its pods and switch are read all the same.
    expect(workloads.jobs["checkout"]).toEqual([
      {
        name: "nightly-report",
        kind: "CronJob",
        suspended: false,
        runs: [],
        absent: "the cluster has no CronJob nightly-report in shop",
      },
    ])
    const orders: Service = {
      ...checkout,
      name: "orders",
      jobs: [],
      debug: { configMap: "orders-logging", key: "LOG_LEVEL", levels: ["INFO", "DEBUG"] },
    }
    const both = await real(readCluster(k3s.cluster, [orders, checkout]))
    expect([both.debug["orders"], both.debug["checkout"]]).toEqual([undefined, { level: "INFO", on: false }])
  })

  test("takes the debug switch under Estate's own RBAC, and reads it back on and off", async () => {
    const now = Date.now()
    await real(switchOn(k3s.cluster, checkout, 30, "ada", now))
    const on = await real(readCluster(k3s.cluster, [checkout]))
    expect(on.debug["checkout"]).toMatchObject({ level: "DEBUG", on: true, by: "ada" })
    await real(switchOff(k3s.cluster, checkout))
    const off = await real(readCluster(k3s.cluster, [checkout]))
    expect(off.debug["checkout"]).toEqual({ level: "INFO", on: false })
    // Acting as a person needs impersonation, which deploy/ does not grant: the cluster's refusal is the answer.
    const refused = await real(
      Effect.flip(switchOn(k3s.cluster, checkout, 30, "gil", now, { name: "gil", groups: [] })),
    )
    expect(refused.message).toStartWith("the cluster answered 403")
  })

  test("gives a CronJob's runs as the Job controller ended them, newest first", async () => {
    await create(
      k3s,
      [
        {
          metadata: { name: "nightly-report" },
          spec: {
            schedule: "0 2 * * *",
            jobTemplate: {
              spec: {
                backoffLimit: 0,
                template: { spec: { ...container("example/report:2"), restartPolicy: "Never" } },
              },
            },
          },
        },
      ],
      () => `${batch}/cronjobs`,
    )
    const cronJob = (await (await k3s.kube(`${batch}/cronjobs/nightly-report`)).json()) as { metadata: { uid: string } }
    for (const [run, phase] of [
      ["nightly-report-1", "Succeeded"],
      ["nightly-report-2", "Failed"],
    ] as const) {
      await create(
        k3s,
        [
          {
            metadata: {
              name: run,
              ownerReferences: [
                { apiVersion: "batch/v1", kind: "CronJob", name: "nightly-report", uid: cronJob.metadata.uid },
              ],
            },
            spec: { backoffLimit: 0, template: { spec: { ...container("example/report:2"), restartPolicy: "Never" } } },
          },
        ],
        () => `${batch}/jobs`,
      )
      const [pod] = await eventually(
        () => podsOf(`job-name=${run}`),
        (pods) => pods.length === 1,
      )
      const exitCode = phase === "Succeeded" ? 0 : 1
      await setStatus(k3s, `${shop}/pods/${pod}`, {
        phase,
        containerStatuses: [
          {
            name: "app",
            image: "example/report:2",
            imageID: "",
            ready: false,
            restartCount: 0,
            state: { terminated: { exitCode, reason: phase === "Failed" ? "Error" : "Completed" } },
          },
        ],
      })
    }
    const jobs = await eventually(
      () => real(readCluster(k3s.cluster, [checkout])).then((read) => read.jobs["checkout"]?.[0]),
      (job) => job?.runs.every((run) => run.outcome !== "running") === true,
    )
    expect(jobs).toMatchObject({ name: "nightly-report", kind: "CronJob", suspended: false })
    expect(jobs?.runs.map((run) => [run.name, run.outcome])).toEqual(
      expect.arrayContaining([
        ["nightly-report-1", "succeeded"],
        ["nightly-report-2", "failed"],
      ]),
    )
    expect(jobs?.runs.find((run) => run.outcome === "failed")?.message).toContain("backoff limit")
  })
})

describe("Flux's resources in a real Kubernetes", () => {
  const crds = [
    "https://raw.githubusercontent.com/fluxcd/kustomize-controller/v1.7.0/config/crd/bases/kustomize.toolkit.fluxcd.io_kustomizations.yaml",
    "https://raw.githubusercontent.com/fluxcd/image-reflector-controller/v1.0.0/config/crd/bases/image.toolkit.fluxcd.io_imagepolicies.yaml",
  ]
  const flux = "/namespaces/flux-system"

  test("give the tag an ImagePolicy chose, and the stall in Flux's words when a policy cannot choose", async () => {
    for (const url of crds) {
      const crd = Bun.YAML.parse(await (await fetch(url)).text()) as Record<string, unknown>
      await create(k3s, [crd], () => "/apis/apiextensions.k8s.io/v1/customresourcedefinitions")
    }
    await create(k3s, [{ metadata: { name: "flux-system" } }], () => "/api/v1/namespaces")
    const kustomizations = `/apis/kustomize.toolkit.fluxcd.io/v1${flux}/kustomizations`
    const policies = `/apis/image.toolkit.fluxcd.io/v1${flux}/imagepolicies`
    await eventually(
      () => Promise.all([k3s.kube(kustomizations), k3s.kube(policies)]),
      (answers) => answers.every((answer) => answer.ok),
      60,
    )
    await create(
      k3s,
      [
        {
          apiVersion: "kustomize.toolkit.fluxcd.io/v1",
          kind: "Kustomization",
          metadata: { name: "shop" },
          spec: { interval: "5m", prune: true, sourceRef: { kind: "GitRepository", name: "shop" } },
        },
      ],
      () => kustomizations,
    )
    await create(
      k3s,
      ["checkout", "search"].map((name) => ({
        apiVersion: "image.toolkit.fluxcd.io/v1",
        kind: "ImagePolicy",
        metadata: { name },
        spec: { imageRepositoryRef: { name }, policy: { semver: { range: ">=1.0.0" } } },
      })),
      () => policies,
    )
    const at = new Date().toISOString()
    const condition = (status: string, reason: string, message: string) => ({
      type: "Ready",
      status,
      reason,
      message,
      lastTransitionTime: at,
      observedGeneration: 1,
    })
    await setStatus(k3s, `${kustomizations}/shop`, {
      lastAppliedRevision: "main@sha1:0123456789abcdef0123456789abcdef01234567",
      conditions: [condition("True", "ReconciliationSucceeded", "Applied revision: main@sha1:0123456")],
    })
    await setStatus(k3s, `${policies}/checkout`, {
      latestRef: { name: "example/checkout", tag: "1.4.2" },
      conditions: [condition("True", "Succeeded", "Latest image tag for example/checkout resolved to 1.4.2")],
    })
    await setStatus(k3s, `${policies}/search`, {
      conditions: [condition("False", "DependencyNotReady", "referenced ImageRepository 'search' is not ready")],
    })
    const chosen = await real(readDeploys(k3s.cluster, [checkout, search]))
    expect(chosen).toEqual({
      checkout: { version: "1.4.2", ready: true, at: expect.any(String) },
      search: {
        version: "main@0123456",
        ready: true,
        at: expect.any(String),
        stalled: "referenced ImageRepository 'search' is not ready",
      },
    })
  })
})
