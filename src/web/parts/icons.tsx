/** @jsxImportSource solid-js */
/** Small line icons, as SVG paths in a 14 by 14 box, for the links a service has. */
const paths: Readonly<Record<string, string>> = {
  logs: "M2 3h10M2 6h10M2 9h7M2 12h5",
  traces: "M2 3h5v3h5M7 6v5h5",
  dashboard: "M2 12V7M5.5 12V2M9 12V5M12.5 12V9",
  cluster: "M7 1.5 12.5 4.5v5L7 12.5 1.5 9.5v-5ZM7 7v5.5M7 7l5.5-2.5M7 7 1.5 4.5",
  repo: "M5 4 2 7l3 3M9 4l3 3-3 3",
  runbook:
    "M2 2.5h4a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 0 6 10.5H2ZM12 2.5H8.5A1.5 1.5 0 0 0 7 4v8a1.5 1.5 0 0 1 1.5-1.5H12Z",
  api: "M4.5 2.5C3 2.5 3 3.5 3 5S2 7 2 7s1 0 1 2-0 2.5 1.5 2.5M9.5 2.5c1.5 0 1.5 1 1.5 2.5s1 2 1 2-1 0-1 2 0 2.5-1.5 2.5",
  app: "M2 3.5h10v7H2ZM2 6h10M5 12.5h4",
  silence: "M3 5.5h2l3-3v9l-3-3H3ZM10.5 5l2.5 4M13 5l-2.5 4",
  link: "M6 8a2.5 2.5 0 0 0 3.5 0l2-2A2.5 2.5 0 0 0 8 2.5l-1 1M8 6a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 6 11.5l1-1",
}

const synonyms: Readonly<Record<string, string>> = {
  headlamp: "cluster",
  kubernetes: "cluster",
  grafana: "dashboard",
  metrics: "dashboard",
  tempo: "traces",
  loki: "logs",
  github: "repo",
  repository: "repo",
  swagger: "api",
  frontend: "app",
  site: "app",
  web: "app",
  openapi: "api",
  docs: "api",
}

const iconFor = (name: string): string => {
  const key = name.toLowerCase()
  const { link = "" } = paths
  return paths[key] ?? paths[synonyms[key] ?? ""] ?? link
}

export const Icon = (props: { readonly name: string }) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d={iconFor(props.name)} />
  </svg>
)
