/** The PreToolUse hook: reads the tool call on stdin and denies it if it would change the gate's configuration. */
import { decide, type ToolCall } from "./guard/decide"

const call: ToolCall = JSON.parse(await Bun.stdin.text())
const reason = decide(call, process.cwd())
if (reason !== undefined) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
    }),
  )
}
