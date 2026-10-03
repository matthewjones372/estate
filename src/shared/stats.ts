/** A service's stats: the usual queries for its kind of process, narrowed to it, and any of its own. */
import type { Service } from "./catalog"

export interface Stat {
  readonly title: string
  readonly query: string
  readonly unit?: string
}

type Preset = NonNullable<NonNullable<Service["stats"]>["preset"]>

const presets: Readonly<Record<Preset, (selector: string) => ReadonlyArray<Stat>>> = {
  jvm: (selector) => [
    { title: "Heap", query: `sum(jvm_memory_used_bytes{area="heap",${selector}})`, unit: "bytes" },
    {
      title: "GC pause",
      query: `sum(rate(jvm_gc_pause_seconds_sum{${selector}}[5m])) / sum(rate(jvm_gc_pause_seconds_count{${selector}}[5m]))`,
      unit: "s",
    },
    { title: "Threads", query: `sum(jvm_threads_live_threads{${selector}})` },
    { title: "CPU", query: `100 * avg(process_cpu_usage{${selector}})`, unit: "%" },
  ],
  process: (selector) => [
    { title: "CPU", query: `sum(rate(process_cpu_seconds_total{${selector}}[5m]))`, unit: "cores" },
    { title: "Memory", query: `sum(process_resident_memory_bytes{${selector}})`, unit: "bytes" },
    { title: "Open files", query: `sum(process_open_fds{${selector}})` },
  ],
  container: (selector) => [
    {
      title: "CPU",
      query: `sum(rate(container_cpu_usage_seconds_total{${selector},container!=""}[5m]))`,
      unit: "cores",
    },
    { title: "Memory", query: `sum(container_memory_working_set_bytes{${selector},container!=""})`, unit: "bytes" },
  ],
}

/** The labels a preset is narrowed by when the catalog names none. */
const defaultSelector = (service: Service, preset: Preset): string =>
  preset === "container"
    ? `namespace="${service.kubernetes?.namespace ?? service.name}",pod=~"${service.name}-.*"`
    : `app="${service.name}"`

export const statsOf = (service: Service): ReadonlyArray<Stat> => {
  const stats = service.stats
  if (stats === undefined) return []
  const preset =
    stats.preset === undefined ? [] : presets[stats.preset](stats.selector ?? defaultSelector(service, stats.preset))
  return [...preset, ...(stats.extra ?? [])]
}
