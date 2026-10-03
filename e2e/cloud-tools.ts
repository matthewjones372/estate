/**
 * Other kinds of tool on one port, answering in their own shapes, for the pages' tests: Grafana's alerting (silences
 * kept), Elasticsearch, Argo CD, GitLab, and ECS and CloudWatch behind one AWS endpoint.
 */
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
const secondsAgo = (minutes: number) => Date.now() / 1000 - minutes * 60
const json = (body: unknown, status = 200) => Response.json(body, { status })

const grafanaSilences = new Map<
  string,
  {
    id: string
    createdBy: string
    comment: string
    startsAt: string
    endsAt: string
    matchers: Array<{ name: string; value: string }>
  }
>()
const storefrontErrors = {
  labels: { alertname: "StorefrontErrors", app: "storefront", grafana_folder: "Shop", __alert_rule_uid__: "e1" },
  annotations: { summary: "Storefront is failing requests" },
  startsAt: minutesAgo(9),
}
const silencedBy = (labels: Record<string, string>) =>
  [...grafanaSilences.values()]
    .filter((silence) => silence.matchers.every((matcher) => labels[matcher.name] === matcher.value))
    .map((silence) => silence.id)

const grafana = async (request: Request, path: string): Promise<Response | undefined> => {
  if (request.headers.get("authorization") !== "Bearer glsa-e2e") return json({ message: "Unauthorized" }, 401)
  // The EKS Prometheus, reached only through Grafana's data source proxy.
  const proxied = "/api/datasources/proxy/uid/prom-eks"
  if (path.startsWith(`${proxied}/`))
    return fetch(
      `http://127.0.0.1:${process.env["TOOLS_PORT"] ?? 8282}${path.slice(proxied.length)}${new URL(request.url).search}`,
    )
  const manager = "/api/alertmanager/grafana/api/v2"
  if (path === `${manager}/alerts`) {
    const by = silencedBy(storefrontErrors.labels)
    return json([
      {
        ...storefrontErrors,
        status: { state: by.length > 0 ? "suppressed" : "active", silencedBy: by, inhibitedBy: [] },
      },
    ])
  }
  if (path === `${manager}/silences` && request.method === "POST") {
    const id = crypto.randomUUID()
    grafanaSilences.set(id, { id, ...(await request.json()) })
    return json({ silenceID: id })
  }
  if (path === `${manager}/silences`) return json([...grafanaSilences.values()])
  if (path.startsWith(`${manager}/silence/`) && request.method === "DELETE") {
    grafanaSilences.delete(path.slice(`${manager}/silence/`.length))
    return json({})
  }
  if (path === "/api/prometheus/grafana/api/v1/alerts")
    return json({
      data: {
        alerts: [
          {
            labels: { alertname: "StorefrontSlow", app: "storefront" },
            annotations: {},
            state: "Pending",
            activeAt: minutesAgo(1),
          },
        ],
      },
    })
  if (path === "/api/ruler/grafana/api/v1/rules")
    return json({
      Shop: [
        {
          name: "storefront",
          rules: [
            {
              grafana_alert: {
                title: "StorefrontErrors",
                condition: "C",
                data: [
                  { refId: "A", model: { expr: 'sum(rate(http_requests_total{app="storefront",code=~"5.."}[1m]))' } },
                  { refId: "B", model: { type: "reduce", expression: "A" } },
                  {
                    refId: "C",
                    model: {
                      type: "threshold",
                      expression: "B",
                      conditions: [{ evaluator: { type: "gt", params: [0.03] } }],
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    })
  return undefined
}

let searched = 0
// Lines are shipped for storefront only, so a search for anything else finds nothing, as it would.
const elasticsearch = async (request: Request): Promise<Response> => {
  if (request.headers.get("authorization") !== "ApiKey e2e") return json({ error: "unauthorised" }, 401)
  if (!(await request.text()).includes('"storefront"')) return json({ hits: { hits: [] } })
  searched += 1
  const at = (back: number) => new Date(Date.now() - back).toISOString()
  const hits = [
    {
      "@timestamp": at(500),
      message: `served /basket in ${8 + (searched % 5)} ms`,
      "log.level": "info",
      kubernetes: { pod: { name: "storefront-7d9f-a" } },
    },
    {
      "@timestamp": at(300),
      message: "card declined by the provider",
      "log.level": "error",
      kubernetes: { pod: { name: "storefront-7d9f-b" } },
    },
  ]
  return json({ hits: { hits: hits.map((source) => ({ _source: source })) } })
}

const argo = (request: Request, path: string): Response | undefined => {
  if (request.headers.get("authorization") !== "Bearer argo-e2e") return json({ message: "no session" }, 401)
  if (path !== "/api/v1/applications/storefront") return undefined
  return json({
    status: {
      sync: { status: "OutOfSync", revision: "c556728aa1" },
      health: { status: "Healthy" },
      operationState: {
        phase: "Failed",
        message: "one or more objects failed to apply: admission webhook denied the request",
        finishedAt: minutesAgo(6),
      },
      summary: { images: ["registry.example/storefront:main-213-9a1b2c3"] },
    },
  })
}

const pipeline = (id: number, sha: string, status: string, minutes: number, project: string) => ({
  id,
  sha,
  status,
  updated_at: minutesAgo(minutes),
  web_url: `https://gitlab.example/shop/${project}/-/pipelines/${id}`,
})

const gitlab = (request: Request, path: string): Response | undefined => {
  if (request.headers.get("private-token") !== "glpat-e2e") return json({ message: "401 Unauthorized" }, 401)
  const project = /^\/api\/v4\/projects\/shop%2F(\w+)\/(.*)$/.exec(path)
  if (project === null) return undefined
  const [, name = "", rest] = project
  if (rest === "pipelines")
    return json(
      name === "storefront"
        ? [pipeline(212, "9a1b2c3dd", "running", 3, name), pipeline(211, "c556728aa", "success", 52, name)]
        : [pipeline(48, "77aa0e1ff", "failed", 18, name), pipeline(47, "5d3e2f1aa", "success", 200, name)],
    )
  if (rest === "repository/commits")
    return json([
      { id: "9a1b2c3dd", title: "Basket badge" },
      { id: "c556728aa", title: "Faster product pages" },
      { id: "77aa0e1ff", title: "Pay by bank" },
      { id: "5d3e2f1aa", title: "Receipts by email" },
    ])
  if (rest === "pipelines/48/jobs") return json([{ name: "integration-tests" }])
  return undefined
}

const task = (id: string, status: string, minutes: number, extra: object = {}) => ({
  taskArn: `arn:aws:ecs:eu-west-2:1:task/shop/${id}`,
  lastStatus: status,
  healthStatus: "HEALTHY",
  startedAt: secondsAgo(minutes),
  availabilityZone: "eu-west-2a",
  containers: [{ name: "checkout", image: "registry.example/checkout:main-31-17edba9", exitCode: 0 }],
  ...extra,
})

const aws = async (request: Request): Promise<Response> => {
  if (!(request.headers.get("authorization") ?? "").startsWith("AWS4-HMAC-SHA256 Credential=e2e/"))
    return json(
      { __type: "UnrecognizedClientException", message: "The security token included in the request is invalid." },
      400,
    )
  const operation = request.headers.get("x-amz-target")?.split(".")[1]
  const body = await request.json()
  if (operation === "ListTasks")
    return json({
      taskArns: body.serviceName === "checkout" ? ["c1", "c2"] : body.desiredStatus === "STOPPED" ? ["n1"] : [],
    })
  if (operation === "DescribeTasks")
    return json({
      tasks:
        body.tasks[0] === "c1"
          ? [task("c1", "RUNNING", 300), task("c2", "RUNNING", 300)]
          : [task("n1", "STOPPED", 600, { stoppedAt: secondsAgo(596), containers: [{ name: "export", exitCode: 0 }] })],
    })
  if (operation === "DescribeServices")
    return json({
      services: [
        {
          serviceName: "checkout",
          deployments: [
            {
              status: "PRIMARY",
              taskDefinition: "arn:aws:ecs:eu-west-2:1:task-definition/checkout:32",
              rolloutState: "FAILED",
              rolloutStateReason: "ECS deployment circuit breaker: tasks failed to start.",
              runningCount: 0,
              desiredCount: 2,
              updatedAt: secondsAgo(12),
            },
          ],
          events: [],
        },
      ],
    })
  if (operation === "DescribeTaskDefinition")
    return json({
      taskDefinition: {
        containerDefinitions: [{ name: "checkout", image: "registry.example/checkout:main-32-a41c0de" }],
      },
    })
  if (operation === "DescribeAlarms")
    return json({
      MetricAlarms: [
        {
          AlarmName: "CheckoutCpuHigh",
          AlarmDescription: "Checkout is using most of its CPU",
          StateValue: "ALARM",
          StateUpdatedTimestamp: secondsAgo(7),
          Namespace: "AWS/ECS",
          MetricName: "CPUUtilization",
          Statistic: "Average",
          Dimensions: [
            { Name: "ClusterName", Value: "shop" },
            { Name: "ServiceName", Value: "checkout" },
          ],
          Threshold: 80,
          ComparisonOperator: "GreaterThanThreshold",
        },
      ],
    })
  if (operation === "GetMetricData") {
    const { StartTime: start, EndTime: end, MetricDataQueries: queries } = body
    const step = queries[0].Period
    const cpu = String(queries[0].Expression).includes("CPUUtilization")
    const timestamps: number[] = []
    for (let at = start; at < end; at += step) timestamps.push(at)
    const values = timestamps.map((at) =>
      cpu ? 70 + 25 * Math.max(0, (at - (end - 900)) / 900) : 40 + 8 * Math.sin(at / 600),
    )
    return json({ MetricDataResults: [{ Id: "estate", Timestamps: timestamps, Values: values }] })
  }
  return json({ __type: "UnknownOperationException", message: `unknown operation ${operation}` }, 400)
}

const server = Bun.serve({
  port: Number(process.env["CLOUD_TOOLS_PORT"] ?? 8283),
  hostname: "127.0.0.1",
  fetch: async (request) => {
    const path = new URL(request.url).pathname
    if (path === "/healthz") return new Response("ok")
    if (path.startsWith("/aws")) return aws(request)
    if (path.endsWith("/_search")) return elasticsearch(request)
    const answered =
      (["/api/alertmanager/", "/api/prometheus/", "/api/ruler/", "/api/datasources/"].some((prefix) =>
        path.startsWith(prefix),
      )
        ? await grafana(request, path)
        : path.startsWith("/api/v1/applications/")
          ? argo(request, path)
          : path.startsWith("/api/v4/")
            ? gitlab(request, path)
            : undefined) ?? json({ message: "Not Found" }, 404)
    return answered
  },
})

process.stdout.write(`cloud tools on ${server.port}\n`)
