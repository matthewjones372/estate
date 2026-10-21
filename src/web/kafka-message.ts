/** A followed message in the page's words (spec 0057): its path, each group's state, and a sentence for it all. */
import type { KafkaCluster } from "../shared/kafka-cluster"
import type { FollowedMessage } from "../shared/kafka-message"
import { duration, exact, took } from "./format"

type Group = FollowedMessage["groups"][number]

const number = (value: number) => value.toLocaleString("en-GB")

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/** How long the messages before it should take, at the group's rate on the partition. */
const wait = (seconds: number | null) =>
  seconds === null ? "its rate is not known" : `about ${duration(seconds * 1000)} at its rate`

/** Each step of its path: who wrote it, where it was kept, and each group, in words. */
export const pathWords = (followed: FollowedMessage, cluster: KafkaCluster | undefined): ReadonlyArray<string> => {
  const { written } = followed
  const leader = cluster?.topics
    .find((topic) => topic.name === written.topic)
    ?.partitions.find((partition) => partition.id === written.partition)?.leader
  const at = `${written.topic} p${written.partition}`
  return [
    `${written.service} wrote it ${exact(written.at)}${written.key === undefined ? "" : `, key ${written.key}`}`,
    `to ${at} at offset ${number(written.offset)}${leader === undefined ? "" : leader === null ? ", with no leader now" : `, broker ${leader} leading`}`,
    ...followed.groups.map((group) => groupWords(group, `p${written.partition}`)),
  ]
}

const groupWords = (group: Group, partition: string): string => {
  switch (group.state) {
    case "read":
      return `${group.name} read it ${exact(group.at)} by ${group.service}, ${took(group.after)} after it was written`
    case "not yet":
      return `${group.name} not yet: at ${number(group.offset)} on ${partition}, ${number(group.before)} messages before it, ${wait(group.seconds)}`
    case "past it":
      return `${group.name} past it: at ${number(group.offset)} on ${partition}, but no span says a traced consumer handled it`
    case "unknown":
      return `${group.name}: its offset on ${partition} is not known`
  }
}

/** What a group's card on the diagram says of the message. */
export const stateWords = (group: Group): string => {
  switch (group.state) {
    case "read":
      return `read it · ${took(group.after)} after`
    case "not yet":
      return `not yet · ${number(group.before)} before it`
    case "past it":
      return "past it"
    case "unknown":
      return "offset not known"
  }
}

/** The follow in a sentence: whether every group has it, and which are short of it by how much. */
export const followSaid = (followed: FollowedMessage): string => {
  const { groups } = followed
  if (groups.length === 0) return `No group reads ${followed.written.topic}.`
  const read = groups.filter((group) => group.state === "read").length
  const past = groups.filter((group) => group.state === "past it").length
  if (followed.done)
    return `Every group has read it or is past it: ${[read > 0 ? `${read} read it` : [], past > 0 ? `${past} past its offset with no span` : []].flat().join(", ")}.`
  const short = groups.flatMap((group) =>
    group.state === "not yet"
      ? [`${group.name} is ${number(group.before)} messages short`]
      : group.state === "unknown"
        ? [`${group.name}'s offset is not known`]
        : [],
  )
  return `${read} of ${plural(groups.length, "group", "groups")} ${read === 1 ? "has" : "have"} read it; ${short.join("; ")}.`
}
