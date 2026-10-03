/** The team that owns something, by its owner's name, and the link to its chat for an alert's card. */
import type { CatalogEvent } from "../shared/events"

export type Team = NonNullable<CatalogEvent["teams"]>[number]

export const teamOf = (catalog: CatalogEvent | undefined, owner: string | undefined): Team | undefined =>
  owner === undefined ? undefined : catalog?.teams?.find((team) => team.name === owner)

/** Its Slack or Teams channel, whichever it names first, and what to call it. */
export const chatOf = (team: Team | undefined) => {
  const chat = team?.links.find((link) => link.name === "slack" || link.name === "teams")
  return chat === undefined || team === undefined
    ? undefined
    : { url: chat.url, text: `${team.title} on ${chat.name === "slack" ? "Slack" : "Teams"}` }
}
