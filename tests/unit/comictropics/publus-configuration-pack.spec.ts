import { describe, expect, it } from "vitest"
import { decodePublusConfigurationPack } from "@/src/site-integrations/comictropics/publus-config"
import vectors from "./publus-pack-vectors.json"

describe("PUBLUS encrypted configuration packs", () => {
  // Synthetic protocol vectors encode explicit JSON and keys. The three body lengths
  // cover unpadded, one-padding-byte and two-padding-byte base64 endings.
  it.each(vectors)(
    "decodes UTF-8 JSON and reconstruction keys (vector %#)",
    ({ raw, expected }) => {
      expect(decodePublusConfigurationPack(raw)).toEqual(expected)
    }
  )

  it("accepts an already decoded configuration without replacing its keys", () => {
    const configuration = vectors[0].expected
    expect(
      decodePublusConfigurationPack(JSON.stringify(configuration))
    ).toEqual(configuration)
  })
})
