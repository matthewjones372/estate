/** Slack's Web API as the e2e estate's bot meets it: messages posted, kept, and a link to each. */

const posted: Array<{ channel: string; text: string; thread_ts?: string }> = []

export const slack = async (path: string, request: Request, url: URL) => {
  if (path === "/api/chat.postMessage") {
    const body = await request.json()
    posted.push(body)
    return Response.json({
      ok: true,
      channel: body.channel,
      ts: `1759491960.${String(posted.length).padStart(6, "0")}`,
    })
  }
  const ts = url.searchParams.get("message_ts") ?? ""
  return Response.json({
    ok: true,
    permalink: `https://example.slack.com/archives/${url.searchParams.get("channel")}/p${ts.replace(".", "")}`,
  })
}
