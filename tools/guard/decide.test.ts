import { describe, expect, test } from "bun:test"
import { decide } from "./decide"

const root = "/repo"
const edit = (file_path: string, tool_name = "Edit") => decide({ tool_name, tool_input: { file_path } }, root)
const bash = (command: string) => decide({ tool_name: "Bash", tool_input: { command } }, root)

describe("the guard", () => {
  test("refuses an edit to the gate's configuration", () => {
    for (const path of [
      "/repo/biome.json",
      "/repo/tsconfig.json",
      "/repo/package.json",
      "/repo/.dependency-cruiser.cjs",
      "/repo/bunfig.toml",
      "/repo/knip.json",
      "/repo/tools/slop/rules.ts",
      "/repo/.claude/settings.json",
      "/repo/.github/workflows/gate.yml",
      "./tools/gate.ts",
    ]) {
      expect(edit(path)).toContain("a person's to change")
    }
    expect(edit("/repo/biome.json", "Write")).toContain("biome.json")
  })

  test("allows an edit anywhere else", () => {
    for (const path of [
      "/repo/src/server/main.ts",
      "/repo/specs/0001.md",
      "/elsewhere/biome.json",
      "/repo/src/tools/a.ts",
    ]) {
      expect(edit(path)).toBeUndefined()
    }
    expect(decide({ tool_name: "Read", tool_input: {} }, root)).toBeUndefined()
    expect(decide({}, root)).toBeUndefined()
  })

  test("refuses a command that writes to the gate's configuration", () => {
    for (const command of [
      "sed -i 's/error/off/' biome.json",
      "echo '{}' > tsconfig.json",
      "cat x >> ./bunfig.toml",
      "rm tools/slop.ts",
      "git checkout HEAD~1 -- knip.json",
      'python3 -c \'open("package.json","w")\'',
      "cp /tmp/settings.json .claude/settings.json",
      "echo x | tee .github/workflows/gate.yml",
    ]) {
      expect(bash(command)).toContain("a person's to change")
    }
  })

  test("allows a command that only reads it, or writes elsewhere", () => {
    for (const command of [
      "cat biome.json",
      "bun tools/gate.ts",
      "bun run gate 2>&1 | tail",
      "bun add effect",
      "sed -i 's/a/b/' src/server/main.ts",
      "grep -n rule tools/slop/rules.ts > /tmp/out",
    ]) {
      expect(bash(command)).toBeUndefined()
    }
    expect(decide({ tool_name: "Bash", tool_input: {} }, root)).toBeUndefined()
  })
})
