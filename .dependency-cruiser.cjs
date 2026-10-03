/** The layers: shared is imported by both sides and imports nothing of ours; server and web never meet. */
module.exports = {
  forbidden: [
    {
      name: "shared-imports-nothing-of-ours",
      severity: "error",
      from: { path: "^src/shared" },
      to: { path: "^(src/(server|web)|tools)/" },
    },
    { name: "server-never-imports-web", severity: "error", from: { path: "^src/server" }, to: { path: "^src/web" } },
    { name: "web-never-imports-server", severity: "error", from: { path: "^src/web" }, to: { path: "^src/server" } },
    { name: "src-never-imports-tools", severity: "error", from: { path: "^src" }, to: { path: "^tools" } },
    { name: "no-circular", severity: "error", from: {}, to: { circular: true } },
    { name: "not-to-unresolvable", severity: "error", from: {}, to: { couldNotResolve: true } },
  ],
  options: {
    includeOnly: "^(src|tools)/",
    doNotFollow: { path: "node_modules" },
    parser: "swc",
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import", "require", "node", "default"] },
  },
}
