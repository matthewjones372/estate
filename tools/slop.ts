/** The slop check: every checked file in the repository, tracked or new, against the rules. */
import { findSlop, isChecked } from "./slop/rules"

const listed = Bun.spawnSync(["git", "ls-files", "--cached", "--others", "--exclude-standard"]).stdout.toString()
const paths = listed.split("\n").filter((path) => path !== "" && isChecked(path))

const findings = (
  await Promise.all(
    paths.map(async (path) => {
      const file = Bun.file(path)
      return (await file.exists()) ? findSlop(path, await file.text()) : []
    }),
  )
).flat()

for (const { path, line, rule } of findings) process.stdout.write(`${path}:${line} ${rule}\n`)
process.stdout.write(`slop: ${findings.length} found in ${paths.length} files\n`)
process.exit(findings.length === 0 ? 0 : 1)
