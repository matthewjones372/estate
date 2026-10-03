import { defineConfig } from "@playwright/test"

/**
 * The pages in a browser: Estate started with the example estate, its tools played by e2e/tools.ts; and a second,
 * cloud estate on other kinds of tool, played by e2e/cloud-tools.ts.
 */
export default defineConfig({
  testDir: "e2e",
  testMatch: "*.pw.ts",
  outputDir: "e2e/results",
  use: {
    baseURL: "http://127.0.0.1:8181",
    launchOptions: process.env["CHROMIUM"] === undefined ? {} : { executablePath: process.env["CHROMIUM"] },
  },
  webServer: [
    { command: "bun e2e/tools.ts", url: "http://127.0.0.1:8282/api/v1/rules", reuseExistingServer: false },
    {
      command: "bun src/server/main.ts",
      url: "http://127.0.0.1:8181/healthz",
      env: { ESTATE_SETTINGS: "e2e/estate.yaml" },
      reuseExistingServer: false,
    },
    { command: "bun e2e/cloud-tools.ts", url: "http://127.0.0.1:8283/healthz", reuseExistingServer: false },
    {
      // A second estate, on Grafana, Elasticsearch, Argo CD, GitLab, ECS and CloudWatch; its keys are only signed.
      command: "bun src/server/main.ts",
      url: "http://127.0.0.1:8183/healthz",
      env: {
        ESTATE_SETTINGS: "e2e/cloud.yaml",
        AWS_ACCESS_KEY_ID: "e2e",
        AWS_SECRET_ACCESS_KEY: "e2e-secret",
      },
      reuseExistingServer: false,
    },
  ],
})
