/** Backstage's catalog, as e2e/tools.ts answers it: one Component, a page of it, that the catalog does not write. */
export const backstageCatalog = {
  items: [
    {
      metadata: {
        name: "recommendations",
        description: "Suggests what each customer may want next",
        annotations: { "github.com/project-slug": "example/recommendations" },
        links: [{ url: "https://grafana.example.com/d/recommendations", title: "Dashboard" }],
      },
      spec: { type: "service", owner: "group:default/web", system: "Shop" },
    },
  ],
}
