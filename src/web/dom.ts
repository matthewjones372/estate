/**
 * The pages' tests run in happy-dom, with the pages compiled by Solid for the browser. Both are set up before a page
 * is imported, so a test file registers them and then imports its suite.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { solidInBrowser } from "../shared/solid"

let compiling = false

export const inBrowser = () => {
  if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
  if (!compiling) Bun.plugin(solidInBrowser.plugin)
  compiling = true
  return () => GlobalRegistrator.unregister()
}
