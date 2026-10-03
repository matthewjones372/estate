/**
 * How Estate holds up with many services: `bun bench/run.ts [services] [pages] [--check]`. Starts the bench's tools
 * and Estate against them, waits for the first reads, then measures for a minute with `pages` pages watching. With
 * `--check`, fails when a measurement breaks its budget, which is set for fifty services, and draws the page again at
 * four times the services: a page whose heap grows faster than its lanes has something reading every service per lane.
 */
import { startEstate } from "./estate"
import { measurePage } from "./page"
import { startTools } from "./tools"

const [services = 50, pages = 5] = process.argv
  .slice(2)
  .filter((arg) => !arg.startsWith("--"))
  .map(Number)
const check = process.argv.includes("--check")
const minute = 60_000

/** Estate's process: CPU seconds used so far and resident memory in MB, from `ps`, as Linux and macOS both give. */
const usage = async (pid: number) => {
  const text = await new Response(Bun.spawn(["ps", "-o", "time=,rss=", "-p", String(pid)]).stdout).text()
  const [time = "0", rss = "0"] = text.trim().split(/\s+/)
  const [days, rest] = time.includes("-") ? time.split("-") : ["0", time]
  const seconds = (rest ?? "0").split(":").reduce((total, part) => total * 60 + Number(part), 0)
  return { cpuSeconds: Number(days) * 86_400 + seconds, rssMB: Math.round(Number(rss) / 1024) }
}

/** A page's stream of events, counting what arrives: everything, and what arrived in the first three seconds. */
const watch = (url: string) => {
  const counted = { first: 0, total: 0 }
  const controller = new AbortController()
  const started = performance.now()
  void fetch(`${url}/events?env=production`, { signal: controller.signal })
    .then(async (response) => {
      const reader = response.body?.getReader()
      for (let read = await reader?.read(); read !== undefined && !read.done; read = await reader?.read()) {
        counted.total += read.value.byteLength
        if (performance.now() - started < 3000) counted.first += read.value.byteLength
      }
    })
    .catch(() => undefined)
  return { counted, stop: () => controller.abort() }
}

/** Waits until the tools have been asked for every range at least once and then nothing for two seconds. */
const firstReadsDone = async (calls: () => number, size: number) => {
  let last = -1
  while (calls() !== last || calls() < size * 6) {
    last = calls()
    await Bun.sleep(2000)
  }
}

/** The page drawn once the first reads are done, at a size of its own, for how it grows. */
const pageAt = async (size: number) => {
  const tools = startTools(size, 20)
  const estate = await startEstate(size, tools.url)
  try {
    await firstReadsDone(tools.calls, size)
    return await measurePage(estate.url, size)
  } finally {
    estate.stop()
    tools.stop()
  }
}

const tools = startTools(services, 20)
const estate = await startEstate(services, tools.url)
try {
  await firstReadsDone(tools.calls, services)
  const watchers = Array.from({ length: pages }, () => watch(estate.url))
  await Bun.sleep(3000)
  const before = { calls: tools.calls(), ...(await usage(estate.pid)), bytes: watchers[0]?.counted.total ?? 0 }
  await Bun.sleep(minute)
  const after = { calls: tools.calls(), ...(await usage(estate.pid)), bytes: watchers[0]?.counted.total ?? 0 }
  for (const watcher of watchers) watcher.stop()
  const page = await measurePage(estate.url, services)
  estate.stop()
  const larger = check ? await pageAt(services * 4) : undefined
  const measured = {
    callsPerSecond: Math.round(((after.calls - before.calls) / minute) * 1000 * 10) / 10,
    firstMB: Math.round((watchers[0]?.counted.first ?? 0) / 1e4) / 100,
    perMinuteMB: Math.round((after.bytes - before.bytes) / 1e4) / 100,
    cpuPercent: Math.round(((after.cpuSeconds - before.cpuSeconds) / 60) * 100),
    memoryMB: after.rssMB,
    drawnSeconds: Math.round(page.drawnMs / 100) / 10,
    pageHeapMB: page.heapMB,
    ...(larger === undefined ? {} : { heapGrowth: Math.round((larger.heapMB / page.heapMB) * 10) / 10 }),
  }
  const budgets: Readonly<Record<string, readonly [string, number]>> = {
    callsPerSecond: ["Calls to the tools a second", 15],
    firstMB: ["First data to a page, MB", 0.2],
    perMinuteMB: ["Data to a page a minute once loaded, MB", 0.05],
    cpuPercent: [`Estate's CPU with ${pages} pages, % of a core`, 15],
    memoryMB: ["Estate's memory, MB", 200],
    drawnSeconds: ["Page drawn, s", 3],
    pageHeapMB: ["Page's heap after a collection, MB", 15],
    heapGrowth: [`Page's heap at ${services * 4} services over at ${services}, times`, 4],
  }
  process.stdout.write(`\n${services} services, ${pages} pages\n\n`)
  process.stdout.write(`| Measured | Value |${check ? " Budget |" : ""}\n|---|---|${check ? "---|" : ""}\n`)
  const broken = Object.entries(measured).flatMap(([key, value]) => {
    const [name, budget] = budgets[key] ?? [key, Number.POSITIVE_INFINITY]
    const over = value > budget
    process.stdout.write(`| ${name} | ${value} |${check ? ` ${budget}${over ? " **over**" : ""} |` : ""}\n`)
    return over ? [name] : []
  })
  process.stdout.write(`${JSON.stringify({ services, pages, ...measured })}\n`)
  if (check && broken.length > 0) {
    process.stderr.write(`\nOver budget: ${broken.join(", ")}\n`)
    process.exitCode = 1
  }
} finally {
  estate.stop()
  tools.stop()
}
