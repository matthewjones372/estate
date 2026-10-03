/** A fake Jenkins, for the cloud estate: payments' main branch, its last build failed on a commit it names. */
const at = (minutesAgo: number) => Date.now() - minutesAgo * 60_000

export const jenkins = (request: Request, path: string): Response => {
  if (request.headers.get("authorization") !== `Basic ${btoa("estate:jenkins-e2e")}`)
    return new Response("Unauthorized", { status: 401 })
  if (path !== "/job/shop/job/payments/job/main/api/json") return new Response("Not Found", { status: 404 })
  return Response.json({
    builds: [
      {
        number: 41,
        result: "FAILURE",
        inProgress: false,
        timestamp: at(12),
        duration: 120_000,
        url: "https://jenkins.example/job/shop/job/payments/job/main/41/",
        actions: [{ lastBuiltRevision: { SHA1: "9f1c2e7" } }],
        changeSets: [{ items: [{ commitId: "9f1c2e7", msg: "Retry the card provider" }] }],
      },
      {
        number: 40,
        result: "SUCCESS",
        inProgress: false,
        timestamp: at(90),
        duration: 100_000,
        url: "https://jenkins.example/job/shop/job/payments/job/main/40/",
      },
    ],
  })
}
