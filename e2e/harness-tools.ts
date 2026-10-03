/**
 * A fake TeamCity and a fake Harness, for the cloud estate's ledger: TeamCity's last builds of its build type, and
 * Harness CD's last deployment to production, which failed after an earlier one succeeded.
 */
const ago = (minutes: number) => Date.now() - minutes * 60_000

/** TeamCity's time, as `20261003T114500+0000`. */
const teamcityTime = (at: number) => `${new Date(at).toISOString().replace(/[-:]/g, "").slice(0, 15)}+0000`

export const teamcity = (request: Request, path: string): Response => {
  if (request.headers.get("authorization") !== "Bearer teamcity-e2e")
    return new Response("Unauthorized", { status: 401 })
  if (path !== "/app/rest/builds") return new Response("Not Found", { status: 404 })
  return Response.json({
    build: [
      {
        number: "88",
        state: "finished",
        status: "SUCCESS",
        webUrl: "https://teamcity.example/build/88",
        finishDate: teamcityTime(ago(30)),
        revisions: { revision: [{ version: "5e1d0a2" }] },
        changes: { change: [{ version: "5e1d0a2", comment: "Post refunds to the ledger" }] },
      },
    ],
  })
}

const deployment = (id: string, status: string, minutes: number, tag: string, message?: string) => ({
  planExecutionId: id,
  status,
  startTs: ago(minutes + 3),
  endTs: ago(minutes),
  ...(message === undefined ? {} : { failureInfo: { message } }),
  moduleInfo: {
    cd: { envIdentifiers: ["datadog"], serviceInfoList: [{ identifier: "ledger", artifacts: { primary: { tag } } }] },
  },
})

export const harness = (request: Request, path: string): Response => {
  if (request.headers.get("x-api-key") !== "harness-e2e")
    return Response.json({ message: "Invalid API key" }, { status: 401 })
  if (path !== "/pipeline/api/pipelines/execution/summary")
    return Response.json({ message: "Not found" }, { status: 404 })
  return Response.json({
    status: "SUCCESS",
    data: {
      content: [
        deployment("d2", "Failed", 10, "v4.2.0", "Deployment exceeded progress deadline"),
        deployment("d1", "Success", 120, "v4.1.9"),
      ],
    },
  })
}
