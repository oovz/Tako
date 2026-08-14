import { z } from "zod"

export const PublusConfigContentSchema = z.looseObject({
  file: z.string().optional(),
  index: z.number().int().optional(),
  type: z.string().optional(),
})

export const PublusConfigPageSchema = z.looseObject({
  No: z.union([z.number(), z.string()]).optional(),
  NS: z.number().optional(),
  PS: z.number().optional(),
  RS: z.number().optional(),
  BlockWidth: z.number().optional(),
  BlockHeight: z.number().optional(),
})

const PublusConfigPageEntrySchema = z.looseObject({
  Page: PublusConfigPageSchema.optional(),
})

export const PublusConfigFileSchema = z.looseObject({
  FileLinkInfo: z
    .looseObject({
      PageLinkInfoList: z.array(PublusConfigPageEntrySchema).optional(),
    })
    .optional(),
})

const PublusConfigKeysSchema = z.strictObject({
  key1: z.string().optional(),
  key2: z.string().optional(),
  key3: z.string().optional(),
})

export const PublusConfigSchema = z.looseObject({
  configuration: z
    .looseObject({
      "file-name-version": z.string().optional(),
      contents: z.array(PublusConfigContentSchema).readonly().optional(),
      keys: PublusConfigKeysSchema.optional(),
    })
    .optional(),
})

export type PublusConfigContent = z.infer<typeof PublusConfigContentSchema>
export type PublusConfigPage = z.infer<typeof PublusConfigPageSchema>
export type PublusConfigFile = z.infer<typeof PublusConfigFileSchema>
export type PublusConfig = z.infer<typeof PublusConfigSchema>

export function parsePublusConfig(value: unknown): PublusConfig {
  return PublusConfigSchema.parse(value)
}
