import { describe, expect, test } from "bun:test"
import { marked, searchOf, shows } from "./log-search"

const parts = (typed: string, text: string) =>
  marked(text, searchOf(typed)).map((part) => (part.mark ? `[${part.text}]` : part.text))

describe("searching a service's lines", () => {
  test("plain text matches anywhere in a line, case aside", () => {
    expect(shows(searchOf("timeout"), "upstream TIMEOUT after 30s")).toBe(true)
    expect(shows(searchOf("timeout"), "served /products")).toBe(false)
    expect(parts("timeout", "a Timeout, then a timeout")).toEqual(["a ", "[Timeout]", ", then a ", "[timeout]"])
  })

  test("a star is anything within the line, and other characters are themselves", () => {
    expect(shows(searchOf("conn*refused"), "Connection refused to db:5432")).toBe(true)
    expect(shows(searchOf("conn*refused"), "refused connection")).toBe(false)
    expect(shows(searchOf("order (41)."), "lost order (41).")).toBe(true)
    expect(shows(searchOf("order (41)."), "lost order 41")).toBe(false)
    expect(parts("conn*refused", "db: connection refused")).toEqual(["db: ", "[connection refused]"])
  })

  test("between slashes is a regular expression, case aside", () => {
    expect(shows(searchOf("/status=5\\d\\d/"), "GET / STATUS=503")).toBe(true)
    expect(shows(searchOf("/status=5\\d\\d/"), "GET / status=404")).toBe(false)
    expect(parts("/5\\d\\d/", "503 then 504")).toEqual(["[503]", " then ", "[504]"])
  })

  test("a pattern that is not one says why, and hides nothing", () => {
    const search = searchOf("/status=(5/")
    expect(search._tag).toBe("Invalid")
    expect(shows(search, "anything")).toBe(true)
    expect(parts("/status=(5/", "status=(5")).toEqual(["status=(5"])
  })

  test("nothing typed, or a pattern that matches nothing, marks nothing and loops never", () => {
    expect(searchOf("  ")._tag).toBe("Empty")
    expect(shows(searchOf(""), "anything")).toBe(true)
    expect(parts("/x*/", "abc")).toEqual(["abc"])
  })
})
