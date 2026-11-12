export type MangaPlusChapter = {
  id: number
  titleId: number
  name: string
  subtitle: string
  type: number
  start: number
  end: number
  verticalOnly?: boolean
  locked?: boolean
}

export type MangaPlusTitle = {
  id: number
  name: string
  author: string
  coverUrl: string
  language: number
}

export type MangaPlusTitleDetail = {
  title?: MangaPlusTitle
  description: string
  rating: number
  chapters: MangaPlusChapter[]
}

export type MangaPlusImage = {
  url: string
  width: number
  height: number
  encryptionKey: string
}

export type MangaPlusViewer = {
  chapterId: number
  images: MangaPlusImage[]
  viewerToken: string
}
