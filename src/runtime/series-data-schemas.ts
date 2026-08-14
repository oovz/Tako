import { z } from "zod"

import type { Chapter } from "@/src/types/chapter"
import type { ComicInfoV2, ComicPageInfo } from "@/src/types/comic-info"
import type { SeriesChapterListResult } from "@/src/types/site-integrations"
import type { SeriesMetadata } from "@/src/types/series-metadata"
import type { SeriesMetadataSnapshot } from "@/src/types/state-snapshots"
import type { VolumeState } from "@/src/types/tab-state"

const SeriesMetadataSnapshotShape = {
  author: z.string().optional(),
  artist: z.string().optional(),
  description: z.string().optional(),
  genres: z.array(z.string()).optional(),
  communityRating: z.number().finite().optional(),
  year: z.number().finite().optional(),
  coverUrl: z.string().optional(),
  alternativeTitles: z.array(z.string()).optional(),
  status: z.string().optional(),
  language: z.string().optional(),
  contentRating: z.string().optional(),
  readingDirection: z.string().optional(),
  publisher: z.string().optional(),
  tags: z.array(z.string()).optional(),
} as const

export const SeriesMetadataSnapshotSchema = z.strictObject(
  SeriesMetadataSnapshotShape
) satisfies z.ZodType<SeriesMetadataSnapshot>

export const SeriesMetadataSchema = z.strictObject({
  title: z.string(),
  ...SeriesMetadataSnapshotShape,
}) satisfies z.ZodType<SeriesMetadata>

const ComicPageInfoSchema = z.strictObject({
  Image: z.number().finite(),
  Type: z
    .enum([
      "FrontCover",
      "InnerCover",
      "Roundup",
      "Story",
      "Advertisement",
      "Editorial",
      "Letters",
      "Preview",
      "BackCover",
      "Other",
      "Deleted",
    ])
    .optional(),
  DoublePage: z.boolean().optional(),
  ImageSize: z.number().finite().optional(),
  Key: z.string().optional(),
  Bookmark: z.string().optional(),
  ImageWidth: z.number().finite().optional(),
  ImageHeight: z.number().finite().optional(),
}) satisfies z.ZodType<ComicPageInfo>

const ComicInfoV2Schema = z.strictObject({
  Title: z.string().optional(),
  Series: z.string().optional(),
  Number: z.string().optional(),
  Count: z.number().finite().optional(),
  Volume: z.number().finite().optional(),
  AlternateSeries: z.string().optional(),
  AlternateNumber: z.string().optional(),
  AlternateCount: z.number().finite().optional(),
  Summary: z.string().optional(),
  Notes: z.string().optional(),
  Year: z.number().finite().optional(),
  Month: z.number().finite().optional(),
  Day: z.number().finite().optional(),
  Writer: z.string().optional(),
  Penciller: z.string().optional(),
  Inker: z.string().optional(),
  Colorist: z.string().optional(),
  Letterer: z.string().optional(),
  CoverArtist: z.string().optional(),
  Editor: z.string().optional(),
  Publisher: z.string().optional(),
  Imprint: z.string().optional(),
  Genre: z.string().optional(),
  Web: z.string().optional(),
  AgeRating: z.string().optional(),
  StoryArc: z.string().optional(),
  SeriesGroup: z.string().optional(),
  CommunityRating: z.number().finite().optional(),
  Review: z.string().optional(),
  ScanInformation: z.string().optional(),
  BlackAndWhite: z.enum(["Yes", "No", "Unknown"]).optional(),
  MainCharacterOrTeam: z.string().optional(),
  PageCount: z.number().finite().optional(),
  LanguageISO: z.string().optional(),
  Format: z.string().optional(),
  Pages: z.array(ComicPageInfoSchema).optional(),
  Manga: z.enum(["Yes", "No", "YesAndRightToLeft"]).optional(),
  Characters: z.string().optional(),
  Teams: z.string().optional(),
  Locations: z.string().optional(),
}) satisfies z.ZodType<ComicInfoV2>

const SeriesChapterSchema = z.strictObject({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  locked: z.boolean().optional(),
  language: z.string().optional(),
  chapterLabel: z.string().optional(),
  chapterNumber: z.number().finite().optional(),
  volumeId: z.string().optional(),
  volumeNumber: z.number().finite().optional(),
  volumeLabel: z.string().optional(),
  resolvedPath: z.string().optional(),
  comicInfo: ComicInfoV2Schema,
}) satisfies z.ZodType<Chapter>

const SeriesVolumeSchema = z.strictObject({
  id: z.string(),
  title: z.string().optional(),
  label: z.string().optional(),
}) satisfies z.ZodType<VolumeState>

export const SeriesChapterListSchema = z.union([
  z.array(SeriesChapterSchema),
  z.strictObject({
    chapters: z.array(SeriesChapterSchema),
    volumes: z.array(SeriesVolumeSchema).optional(),
    truncated: z.boolean().optional(),
  }),
]) satisfies z.ZodType<SeriesChapterListResult>
