import { defineConfig } from "@playwright/test"

/** The pages in a browser: Estate started with the example estate, its tools played by e2e/tools.ts. */
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
  ],
})
