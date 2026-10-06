/** What the example estate costs: OpenCost's allocation for the shared cluster, and Anthropic's report, in cents. */

const daysAgo = (days: number) => `${new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)}T00:00:00Z`

export const allocation = (url: URL) => ({
  code: 200,
  data: [
    {
      "shop/orders": {
        properties: { namespace: "shop", controller: "orders" },
        totalCost: url.searchParams.get("window") === "month" ? 212.4 : 31.7,
      },
      "shop/storefront": { properties: { namespace: "shop", controller: "storefront" }, totalCost: 96 },
    },
  ],
})

export const costReport = () => ({
  data: [
    { starting_at: daysAgo(1), results: [{ amount: "2850", workspace_id: "wrk_support" }] },
    { starting_at: daysAgo(0), results: [{ amount: "900", workspace_id: "wrk_support" }] },
  ],
})
