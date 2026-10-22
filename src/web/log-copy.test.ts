import { describe, expect, test } from "bun:test"
import { asText, fileName, fromWhere } from "./log-copy"

describe("copying a service's lines", () => {
  test("each line is its time in full, pod, level and text, between tabs", () => {
    expect(
      asText([
        { at: "2026-10-07T10:31:02.123Z", pod: "orders-7f9c", level: "error", text: "connection refused" },
        { at: "2026-10-07T10:31:03.000Z", text: "no pod, no level" },
      ]),
    ).toBe(
      "2026-10-07T10:31:02.123Z\torders-7f9c\tERROR\tconnection refused\n2026-10-07T10:31:03.000Z\t\t\tno pod, no level",
    )
  })

  test("a line whose text begins with its level names it once", () => {
    expect(asText([{ at: "2026-10-07T10:31:02.123Z", level: "INFO", text: "INFO  petshop.app -- arrived" }])).toBe(
      "2026-10-07T10:31:02.123Z\t\tINFO\tpetshop.app -- arrived",
    )
  })

  test("a copy starts with the service, the environment and the address of its logs there", () => {
    expect(fromWhere("https://estate.example", { service: "orders api", environment: "production" })).toBe(
      "orders api in production · https://estate.example/services/orders%20api?env=production",
    )
    expect(
      fromWhere("https://estate.example", {
        service: "orders",
        environment: "staging",
        logs: { view: "errors", range: "6h" },
      }),
    ).toBe("orders in staging · https://estate.example/services/orders?logs=errors&range=6h&env=staging")
  })

  test("a saved file is named for the service, the environment and the minute", () => {
    expect(fileName("orders", "production", Date.parse("2026-10-07T10:31:59Z"))).toBe(
      "orders-production-2026-10-07T1031.log",
    )
  })
})
