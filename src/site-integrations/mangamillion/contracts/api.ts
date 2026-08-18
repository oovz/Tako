import { z } from "zod"

export const MangaMillionDeviceTokenSchema = z.looseObject({
  token: z.string().optional(),
})

export const MangaMillionServiceTitleSchema = z.looseObject({
  coverUrl: z.string().optional(),
  serviceTitleName: z.string().optional(),
  authorName: z.string().optional(),
  description: z.string().optional(),
  disclaimerText: z.string().optional(),
})

export const MangaMillionTitleDetailSchema = z.looseObject({
  serviceTitle: MangaMillionServiceTitleSchema.optional(),
  isMPlusRegion: z.boolean().optional(),
})

export const MangaMillionChapterInfoSchema = z.looseObject({
  number: z.string().optional(),
  name: z.string().optional(),
  translatedChapterId: z.number().int().optional(),
  commentCount: z.number().int().optional(),
  thumbnailUrl: z.string().optional(),
  read: z.boolean().optional(),
})

export const MangaMillionChapterGroupSchema = z.looseObject({
  groupType: z.number().int().optional(),
  chapters: z.array(MangaMillionChapterInfoSchema).optional(),
})

export const MangaMillionChapterListSchema = z.looseObject({
  totalChapters: z.number().int().optional(),
  chapterGroups: z.array(MangaMillionChapterGroupSchema).optional(),
  isMPlusRegion: z.boolean().optional(),
  availableChapters: z.number().int().optional(),
})

export const MangaMillionViewerPageSchema = z.looseObject({
  imageUrl: z.string().optional(),
  widthPx: z.number().int().optional(),
  heightPx: z.number().int().optional(),
  pageType: z.number().int().optional(),
})

export const MangaMillionViewerChapterSchema = z.looseObject({
  serviceTitleName: z.string().optional(),
  originalTitleId: z.number().int().optional(),
  number: z.string().optional(),
  prevId: z.number().int().optional(),
  nextId: z.number().int().optional(),
  commentCount: z.number().int().optional(),
})

export const MangaMillionViewerSchema = z.looseObject({
  pages: z.array(MangaMillionViewerPageSchema).optional(),
  chapter: MangaMillionViewerChapterSchema.optional(),
  aesKey: z.string().optional(),
  aesIv: z.string().optional(),
  maxImageQuality: z.number().int().optional(),
})

export const MangaMillionResponseSchema = z.looseObject({
  status: z.number().int(),
  errorMessage: z.string().optional(),
  deviceTokenRegister: MangaMillionDeviceTokenSchema.optional(),
  titleDetail: MangaMillionTitleDetailSchema.optional(),
  chapterList: MangaMillionChapterListSchema.optional(),
  viewer: MangaMillionViewerSchema.optional(),
})

export type MangaMillionDeviceToken = z.infer<
  typeof MangaMillionDeviceTokenSchema
>
export type MangaMillionServiceTitle = z.infer<
  typeof MangaMillionServiceTitleSchema
>
export type MangaMillionTitleDetail = z.infer<
  typeof MangaMillionTitleDetailSchema
>
export type MangaMillionChapterInfo = z.infer<
  typeof MangaMillionChapterInfoSchema
>
export type MangaMillionChapterGroup = z.infer<
  typeof MangaMillionChapterGroupSchema
>
export type MangaMillionChapterList = z.infer<
  typeof MangaMillionChapterListSchema
>
export type MangaMillionViewerPage = z.infer<
  typeof MangaMillionViewerPageSchema
>
export type MangaMillionViewerChapter = z.infer<
  typeof MangaMillionViewerChapterSchema
>
export type MangaMillionViewer = z.infer<typeof MangaMillionViewerSchema>
export type MangaMillionResponse = z.infer<typeof MangaMillionResponseSchema>
