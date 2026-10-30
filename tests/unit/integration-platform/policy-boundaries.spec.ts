import { describe, expect, it } from "vitest"

import { assertSafePublicHttpsUrl } from "@/src/site-integrations/request-policy"
import {
  assertValidSettingsFieldSchema,
  assertValidSettingsFieldValue,
  getDisplayName,
} from "@/src/site-integrations/catalog"
import { assertValidSessionRefererRuleDeclaration } from "@/src/site-integrations/definition-validation"
import type { SiteIntegrationSettingsField } from "@/src/site-integrations/definition-types"

describe("public HTTPS address policy", () => {
  it.each([
    "0.1.2.3",
    "100.64.0.0",
    "100.127.255.255",
    "172.16.0.0",
    "172.31.255.255",
    "192.0.0.1",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.19.255.255",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.0",
    "255.255.255.255",
    "[::]",
    "[ff02::1]",
    "[2001:db8::1]",
    "[::ffff:192.168.1.1]",
    "[fdff::1]",
    "[febf::1]",
    "api.internal",
    "api.home.arpa",
    "api.localhost",
  ])("rejects the non-public host %s", (host) => {
    expect(() => assertSafePublicHttpsUrl(`https://${host}/`)).toThrow()
  })

  it.each([
    "100.63.255.255",
    "100.128.0.0",
    "172.15.255.255",
    "172.32.0.0",
    "192.0.1.1",
    "192.0.3.1",
    "198.17.255.255",
    "198.20.0.0",
    "198.51.99.255",
    "203.0.114.0",
    "223.255.255.255",
    "[::ffff:8.8.8.8]",
    "[2001:4860:4860::8888]",
    "[fec0::1]",
  ])("preserves the public host %s", (host) => {
    expect(assertSafePublicHttpsUrl(`https://${host}/`).protocol).toBe("https:")
  })

  it("rejects malformed URLs before classifying their host", () => {
    expect(() => assertSafePublicHttpsUrl("https://[1::2::3]/")).toThrow()
    expect(() => assertSafePublicHttpsUrl("not a URL")).toThrow()
  })
})

describe("integration setting value boundaries", () => {
  it("uses the packaged display name and preserves unknown integration identities", () => {
    expect(getDisplayName("mangadex")).toBe("MangaDex")
    expect(getDisplayName("retired-integration")).toBe("retired-integration")
  })
  const fields: SiteIntegrationSettingsField[] = [
    {
      id: "enabled",
      labelKey: "enabled",
      type: "boolean",
      defaultValue: false,
    },
    { id: "token", labelKey: "token", type: "string", defaultValue: "" },
    { id: "limit", labelKey: "limit", type: "number", defaultValue: 0 },
    {
      id: "quality",
      labelKey: "quality",
      type: "select",
      defaultValue: "a",
      options: [{ labelKey: "a", value: "a" }],
    },
    {
      id: "languages",
      labelKey: "languages",
      type: "multiselect",
      defaultValue: [],
      options: [
        { labelKey: "a", value: "a" },
        { labelKey: "b", value: "b" },
      ],
    },
  ]

  it.each(fields)("accepts the declared $type default", (field) => {
    expect(() => assertValidSettingsFieldSchema(field)).not.toThrow()
  })

  it.each<[number, unknown]>([
    [0, "true"],
    [1, 2],
    [2, Number.NaN],
    [2, Infinity],
    [2, "1"],
    [3, "missing"],
    [3, ["a"]],
    [4, "a"],
    [4, ["a", "a"]],
    [4, ["missing"]],
    [4, [1]],
  ])("rejects an incompatible value for field %s", (index, value) => {
    expect(() => assertValidSettingsFieldValue(fields[index], value)).toThrow()
  })

  it("accepts a unique multiselection of declared options", () => {
    expect(() =>
      assertValidSettingsFieldValue(fields[4], ["b", "a"])
    ).not.toThrow()
  })

  it("requires identifiers and complete option labels", () => {
    expect(() =>
      assertValidSettingsFieldSchema({ ...fields[0], id: " " })
    ).toThrow()
    expect(() =>
      assertValidSettingsFieldSchema({ ...fields[0], labelKey: " " })
    ).toThrow()
    expect(() =>
      assertValidSettingsFieldSchema({
        id: "quality",
        labelKey: "quality",
        type: "select",
        defaultValue: "a",
        options: [{ labelKey: " ", value: "a" }],
      })
    ).toThrow()
    expect(() =>
      assertValidSettingsFieldSchema({
        id: "quality",
        labelKey: "quality",
        type: "select",
        defaultValue: " ",
        options: [{ labelKey: "blank", value: " " }],
      })
    ).toThrow()
  })
})

describe("session referer rule declaration boundaries", () => {
  const rule = {
    id: 41_000,
    requestDomains: ["images.example.com"],
    resourceTypes: ["other" as const],
    referer: "https://reader.example.com/",
  }

  it.each([40_999, 42_000, 41_000.5, Number.NaN])(
    "rejects unmanaged or non-integral rule id %s",
    (id) => {
      expect(() =>
        assertValidSessionRefererRuleDeclaration({ ...rule, id })
      ).toThrow()
    }
  )

  it.each([0, -1, 1.5, Infinity])("rejects invalid priority %s", (priority) => {
    expect(() =>
      assertValidSessionRefererRuleDeclaration({ ...rule, priority })
    ).toThrow()
  })

  it("accepts managed bounds, supported targets and a positive priority", () => {
    expect(() =>
      assertValidSessionRefererRuleDeclaration({
        ...rule,
        id: 41_999,
        priority: 2,
        resourceTypes: ["xmlhttprequest", "other"],
      })
    ).not.toThrow()
  })

  it("requires domains, supported resource types and a credential-free HTTPS referer", () => {
    expect(() =>
      assertValidSessionRefererRuleDeclaration({ ...rule, requestDomains: [] })
    ).toThrow()
    expect(() =>
      assertValidSessionRefererRuleDeclaration({
        ...rule,
        requestDomains: ["images.example.com/path"],
      })
    ).toThrow()
    expect(() =>
      assertValidSessionRefererRuleDeclaration({
        ...rule,
        requestDomains: [""],
      })
    ).toThrow()
    expect(() =>
      assertValidSessionRefererRuleDeclaration({ ...rule, resourceTypes: [] })
    ).toThrow()
    expect(() =>
      assertValidSessionRefererRuleDeclaration({
        ...rule,
        referer: "http://reader.example.com/",
      })
    ).toThrow()
    expect(() =>
      assertValidSessionRefererRuleDeclaration({
        ...rule,
        referer: "https://user:pass@reader.example.com/",
      })
    ).toThrow()
  })
})
