/** Code health's tools, as e2e/tools.ts answers them: storefront's SonarQube analysis and its GitHub alerts. */
export const codeAnswer = (path: string): unknown => {
  if (path === "/api/qualitygates/project_status") return { projectStatus: { status: "OK" } }
  if (path === "/api/measures/component")
    return {
      component: {
        measures: [
          { metric: "coverage", value: "82.4" },
          { metric: "bugs", value: "0" },
          { metric: "vulnerabilities", value: "0" },
          { metric: "code_smells", value: "12" },
        ],
      },
    }
  if (path === "/repos/example/storefront/dependabot/alerts") return [{ security_advisory: { severity: "high" } }]
  if (path === "/repos/example/storefront/code-scanning/alerts")
    return [{ rule: { severity: "warning", security_severity_level: "medium" } }]
  return undefined
}
