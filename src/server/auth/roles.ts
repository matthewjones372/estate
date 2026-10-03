/** A person's role from their groups: operator over viewer; neither is no access. */
import type { Me } from "../../shared/events"
import type { AuthSettings } from "../settings"

export type Role = Me["role"]

export const roleOf = (groups: ReadonlyArray<string>, roles: AuthSettings["roles"]): Role | undefined => {
  if (groups.some((group) => roles.operator.includes(group))) return "operator"
  if (groups.some((group) => roles.viewer.includes(group))) return "viewer"
  return undefined
}
