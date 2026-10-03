import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Redacted } from "effect"
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers"
import { readBuilds } from "../src/server/sources/builds"
import { eventually, real, urlOf } from "./real"

// Jenkins as a team sets it up: sign-in required, a user with an API token for Estate, and a job whose second
// build fails and whose third runs on.
const init = `
import jenkins.model.Jenkins
import hudson.security.HudsonPrivateSecurityRealm
import hudson.security.FullControlOnceLoggedInAuthorizationStrategy
import hudson.model.FreeStyleProject
import hudson.model.User
import hudson.tasks.Shell
import jenkins.security.ApiTokenProperty

def jenkins = Jenkins.get()
def realm = new HudsonPrivateSecurityRealm(false)
realm.createAccount("estate", "a-password-nobody-uses")
jenkins.setSecurityRealm(realm)
def strategy = new FullControlOnceLoggedInAuthorizationStrategy()
strategy.setAllowAnonymousRead(false)
jenkins.setAuthorizationStrategy(strategy)
jenkins.setNumExecutors(2)
def job = jenkins.createProject(FreeStyleProject, "checkout")
job.buildersList.add(new Shell('if [ "$BUILD_NUMBER" = 2 ]; then exit 1; fi; if [ "$BUILD_NUMBER" = 3 ]; then sleep 600; fi'))
job.save()
def user = User.getById("estate", true)
def token = user.getProperty(ApiTokenProperty).tokenStore.generateNewToken("estate")
user.save()
jenkins.save()
java.util.logging.Logger.getLogger("estate").info("estate-token " + token.plainValue)
`

let jenkins: StartedTestContainer
let token = ""

const authorization = () => `Basic ${btoa(`estate:${token}`)}`

/** The job's builds as Jenkins itself says, to wait on. */
const said = async () =>
  (await (
    await fetch(`${urlOf(jenkins, 8080)}/job/checkout/api/json?tree=builds[number,result,inProgress]`, {
      headers: { authorization: authorization() },
    })
  ).json()) as { builds: ReadonlyArray<{ number: number; result: string | null; inProgress: boolean }> }

const build = async (number: number, until: (builds: Awaited<ReturnType<typeof said>>["builds"]) => boolean) => {
  const answered = await fetch(`${urlOf(jenkins, 8080)}/job/checkout/build`, {
    method: "POST",
    headers: { authorization: authorization() },
  })
  if (answered.status !== 201) throw new Error(`Jenkins answered ${answered.status} to build ${number}`)
  await eventually(said, (answer) => until(answer.builds), 120)
}

beforeAll(async () => {
  jenkins = await new GenericContainer("jenkins/jenkins:2.528.1-lts-jdk21")
    .withEnvironment({ JAVA_OPTS: "-Djenkins.install.runSetupWizard=false" })
    .withCopyContentToContainer([{ content: init, target: "/var/jenkins_home/init.groovy.d/estate.groovy" }])
    .withExposedPorts(8080)
    // The token is read from Jenkins's log, as testcontainers' exec does not finish under Bun.
    .withLogConsumer((stream) =>
      stream.on("data", (line: string | Buffer) => {
        const found = /estate-token (\S+)/.exec(String(line))
        if (found?.[1] !== undefined) token = found[1]
      }),
    )
    .withWaitStrategy(Wait.forLogMessage(/Jenkins is fully up and running/))
    .withStartupTimeout(240_000)
    .start()
  if (token === "") throw new Error("Jenkins logged no token for Estate")
  await build(1, (builds) => builds.some((each) => each.number === 1 && each.result === "SUCCESS"))
  await build(2, (builds) => builds.some((each) => each.number === 2 && each.result === "FAILURE"))
  await build(3, (builds) => builds.some((each) => each.number === 3 && each.inProgress))
}, 400_000)

afterAll(async () => {
  await jenkins?.stop()
})

describe("a real Jenkins", () => {
  test("gives a job's builds to a user's API token: running, failed and passed, newest first", async () => {
    const jenkinsSettings = { url: urlOf(jenkins, 8080), user: "estate", token: Redacted.make(token) }
    const read = await real(
      readBuilds({ jenkins: jenkinsSettings }, [
        { name: "checkout", environments: [], build: { jenkins: { job: "checkout" } } },
      ]),
    )
    const builds = read[0]?.[1] ?? []
    expect(builds.map((each) => [each.title, each.status])).toEqual([
      ["#3", "running"],
      ["#2", "failure"],
      ["#1", "success"],
    ])
    expect(builds[0]?.url).toEndWith("/job/checkout/3/")
  })

  test("that refuses a wrong token, or has no such job, says so naming the job", async () => {
    const wrong = { url: urlOf(jenkins, 8080), user: "estate", token: Redacted.make("not-the-token") }
    const missing = { url: urlOf(jenkins, 8080), user: "estate", token: Redacted.make(token) }
    const service = (job: string) => [{ name: "checkout", environments: [], build: { jenkins: { job } } }]
    const refused = await real(readBuilds({ jenkins: wrong }, service("checkout"))).catch(
      (error: Error) => error.message,
    )
    const absent = await real(readBuilds({ jenkins: missing }, service("payments"))).catch(
      (error: Error) => error.message,
    )
    expect(refused).toStartWith("Jenkins answered 401 for checkout")
    expect(absent).toStartWith("Jenkins answered 404 for payments")
  })
})
