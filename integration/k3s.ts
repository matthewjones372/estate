/**
 * A real Kubernetes API for the suites: k3s's control plane, without its agent. Kubernetes' own controllers make
 * ReplicaSets, Pods and Jobs as they would anywhere; with no kubelet, nothing runs them, so a suite says how each pod
 * is, through the status subresource, as a kubelet would. Estate signs in with a bearer token, as in a cluster.
 */
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers"
import type { Cluster } from "../src/server/sources/kubernetes"
import { eventually } from "./real"

/** Who may sign in: the suite as an administrator, and Estate as its service account, held to deploy/rbac.yaml. */
const admin = "an-administrator-token"
const estate = "estates-service-account-token"
export const estateUser = "system:serviceaccount:estate:estate"

const tokens = [
  `${admin},admin,admin,"system:masters"`,
  `${estate},${estateUser},estate,"system:serviceaccounts,system:serviceaccounts:estate"`,
].join("\n")

export interface K3s {
  readonly container: StartedTestContainer
  /** The cluster as Estate is given it: the API's URL, Estate's token, and the cluster's CA. */
  readonly cluster: Cluster
  /** A call to the API as the administrator. */
  readonly kube: (path: string, init?: { method?: string; body?: unknown; patch?: boolean }) => Promise<Response>
}

export const startK3s = async (): Promise<K3s> => {
  const container = await new GenericContainer("rancher/k3s:v1.33.4-k3s1")
    .withPrivilegedMode()
    .withCopyContentToContainer([{ content: tokens, target: "/etc/estate-tokens.csv" }])
    .withCommand([
      "server",
      "--disable-agent",
      "--disable=traefik,servicelb,metrics-server,local-storage,coredns",
      "--disable-helm-controller",
      "--disable-network-policy",
      "--kube-apiserver-arg=token-auth-file=/etc/estate-tokens.csv",
    ])
    .withExposedPorts(6443)
    // The API answers some seconds later; the read of its CA below waits for that.
    .withWaitStrategy(Wait.forLogMessage(/Running kube-apiserver/))
    .withStartupTimeout(120_000)
    .start()
  const url = `https://${container.getHost()}:${container.getMappedPort(6443)}`
  // The CA is not known until the cluster publishes it, so this one read trusts whatever answers.
  const published = await eventually(
    () =>
      fetch(`${url}/api/v1/namespaces/default/configmaps/kube-root-ca.crt`, {
        headers: { authorization: `Bearer ${admin}` },
        tls: { rejectUnauthorized: false },
      }).then((answer) => (answer.ok ? (answer.json() as Promise<{ data: { "ca.crt": string } }>) : undefined)),
    (answer) => answer !== undefined,
    60,
  )
  const ca = published?.data["ca.crt"] ?? ""
  const kube: K3s["kube"] = (path, init = {}) =>
    fetch(`${url}${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: {
        authorization: `Bearer ${admin}`,
        "content-type": init.patch === true ? "application/merge-patch+json" : "application/json",
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      tls: { ca },
    })
  return { container, cluster: { url, headers: { authorization: `Bearer ${estate}` }, ca }, kube }
}

/** Creates each object at the path `paths` gives it, as `kubectl create -f` does. */
export const create = async (
  k3s: K3s,
  objects: ReadonlyArray<Record<string, unknown>>,
  paths: (object: Record<string, unknown>) => string,
) => {
  for (const object of objects) {
    const answer = await k3s.kube(paths(object), { body: object })
    if (!answer.ok) throw new Error(`${paths(object)} answered ${answer.status}: ${await answer.text()}`)
  }
}

/** Merges `status` into an object's status, as its controller or kubelet would. */
export const setStatus = async (k3s: K3s, path: string, status: Record<string, unknown>) => {
  const answer = await k3s.kube(`${path}/status`, { method: "PATCH", patch: true, body: { status } })
  if (!answer.ok) throw new Error(`${path}/status answered ${answer.status}: ${await answer.text()}`)
}
