/** The `deploys` event: every service across every environment, with its builds, chosen and running versions. */
import { compact } from "../../shared/compact"
import type { DeploysEvent } from "../../shared/events"
import type { EstateState } from "../state"
import { versionOf } from "./services"

export const deploysView = (estate: EstateState): DeploysEvent => {
  const environments = estate.catalog.environments.map((environment) => environment.name)
  return {
    environments,
    services: estate.catalog.services.map((service) => ({
      name: service.name,
      builds: estate.builds.value?.[service.name] ?? [],
      environments: environments
        .filter((environment) => service.environments.includes(environment))
        .map((environment) => {
          const state = estate.environments[environment]
          const pods = state?.cluster.value?.pods[service.name] ?? []
          const chosen = state?.deploys.value?.[service.name]
          return compact({
            environment,
            running: versionOf(pods.find((pod) => pod.ready)?.image ?? pods[0]?.image),
            chosen:
              chosen === undefined
                ? undefined
                : compact({ version: chosen.version, ready: chosen.ready, at: chosen.at }),
            stalled: chosen?.stalled,
          })
        }),
    })),
  }
}
