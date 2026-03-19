export interface AtHomeResponse {
  result?: string;
  baseUrl: string;
  chapter: {
    hash: string;
    data: string[];
    dataSaver: string[];
  };
}

export interface MangadexImageDeliveryTarget {
  baseUrl: string;
  quality: 'data' | 'data-saver';
  filename: string;
}

function buildMangadexImageUrl(baseUrl: string, quality: 'data' | 'data-saver', chapterHash: string, filename: string): string {
  return `${baseUrl}/${quality}/${chapterHash}/${filename}`;
}

export function parseMangadexImageDeliveryTarget(imageUrl: string): MangadexImageDeliveryTarget | null {
  const parsedUrl = new URL(imageUrl);
  const pathnameParts = parsedUrl.pathname.split('/').filter(Boolean);
  const qualityIndex = pathnameParts.findIndex((part) => part === 'data' || part === 'data-saver');
  if (qualityIndex === -1 || pathnameParts.length < qualityIndex + 3) {
    return null;
  }

  const quality = pathnameParts[qualityIndex];
  const filename = pathnameParts[qualityIndex + 2];
  if ((quality !== 'data' && quality !== 'data-saver') || !filename) {
    return null;
  }

  const basePath = pathnameParts.slice(0, qualityIndex).join('/');
  const baseUrl = basePath.length > 0
    ? `${parsedUrl.origin}/${basePath}`
    : parsedUrl.origin;

  return { baseUrl, quality, filename };
}

export function normalizeMangadexBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

export function isSameMangadexBaseUrl(left: string, right: string): boolean {
  return normalizeMangadexBaseUrl(left) === normalizeMangadexBaseUrl(right);
}

function resolveMangadexImageFilenameForQuality(files: string[], deliveryTarget: MangadexImageDeliveryTarget): string {
  const exactMatch = files.find((file) => file === deliveryTarget.filename);
  const pagePrefix = deliveryTarget.filename.split('-')[0];
  const prefixMatch = pagePrefix.length > 0
    ? files.find((file) => file.startsWith(`${pagePrefix}-`) || file === deliveryTarget.filename)
    : undefined;

  return exactMatch ?? prefixMatch ?? deliveryTarget.filename;
}

export function resolveMangadexImageUrlForQuality(
  atHome: AtHomeResponse,
  deliveryTarget: MangadexImageDeliveryTarget,
  quality: 'data' | 'data-saver' = deliveryTarget.quality,
): string {
  const files = quality === 'data' ? atHome.chapter.data : atHome.chapter.dataSaver;
  const resolvedFilename = resolveMangadexImageFilenameForQuality(files, deliveryTarget);

  return buildMangadexImageUrl(atHome.baseUrl, quality, atHome.chapter.hash, resolvedFilename);
}

export function buildMangadexUploadsRecoveryImageUrl(
  uploadsBase: string,
  atHome: AtHomeResponse,
  deliveryTarget: MangadexImageDeliveryTarget,
): string {
  const files = deliveryTarget.quality === 'data' ? atHome.chapter.data : atHome.chapter.dataSaver;
  const resolvedFilename = resolveMangadexImageFilenameForQuality(files, deliveryTarget);

  return buildMangadexImageUrl(uploadsBase, deliveryTarget.quality, atHome.chapter.hash, resolvedFilename);
}

export function buildPageUrls(atHome: AtHomeResponse, quality: 'data' | 'data-saver'): string[] {
  const baseUrl = atHome.baseUrl;
  const hash = atHome.chapter.hash;
  const files = quality === 'data' ? atHome.chapter.data : atHome.chapter.dataSaver;

  if (!Array.isArray(files)) {
    throw new Error('Malformed MangaDex at-home response: missing image file list');
  }

  return files.map((fileName) => `${baseUrl}/${quality}/${hash}/${fileName}`);
}
