/** What every part of the page can reach: the store, the person, where we are, and the actions they may take. */
import { createContext, useContext, useSyncExternalStore } from "react"
import type { Me, ServiceState } from "../shared/events"
import type { Live, Snapshot } from "./live"
import type { Page } from "./route"

export interface Actions {
  readonly navigate: (path: string) => void
  readonly choose: (environment: string) => void
  readonly addNote: (alert: string, text: string) => Promise<boolean>
  readonly silence: (alert: string, minutes: number, reason: string) => Promise<boolean>
  readonly unsilence: (silence: string) => Promise<boolean>
  readonly debug: (service: string, minutes: number) => Promise<boolean>
  readonly undebug: (service: string) => Promise<boolean>
  readonly load: (service: string, range: Range) => Promise<ServiceState["load"] | undefined>
}

export type Range = "1h" | "6h" | "24h" | "7d"

export interface Estate {
  readonly live: Live
  readonly me: Me
  readonly page: Page
  readonly actions: Actions
  readonly now: () => number
}

export const EstateContext = createContext<Estate | undefined>(undefined)

export const useEstate = (): Estate => {
  const estate = useContext(EstateContext)
  if (estate === undefined) throw new Error("useEstate outside EstateContext")
  return estate
}

export const useSnapshot = (): Snapshot => {
  const { live } = useEstate()
  return useSyncExternalStore(live.subscribe, live.snapshot, live.snapshot)
}
