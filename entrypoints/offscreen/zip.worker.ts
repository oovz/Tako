// Web Worker: create ZIP/CBZ archives from images and metadata using fflate streaming
// Runs CPU-heavy zipping off the main offscreen thread with streaming compression.
import { Zip, AsyncZipDeflate, strToU8 } from 'fflate';
import { normalizeImageFilename } from '@/src/shared/filename-sanitizer';
import logger from '@/src/runtime/logger';

// Message-based streaming protocol to avoid buffering full chapter images in memory
// Worker commands
type InitMsg = { 
  type: 'init'; 
  chapterTitle: string; 
  extension: 'cbz' | 'zip';
  // Image filename normalization settings
  normalizeImageFilenames?: boolean;
  imagePaddingDigits?: 'auto' | 2 | 3 | 4 | 5;
  totalImages?: number; // Required if normalization enabled
};
type AddComicInfoMsg = { type: 'addComicInfo'; xml: string };
type AddCoverMsg = { type: 'addCover'; buffer: ArrayBuffer; extension: string };
type AddImageMsg = { 
  type: 'addImage'; 
  filename: string; 
  buffer: ArrayBuffer;
  // Additional data for normalization
  index?: number; // Image index (0-based)
  mimeType?: string; // Image MIME type for extension detection
};
type FinalizeMsg = { type: 'finalize' };
type ResetMsg = { type: 'reset' };
// Batch API (used by archive-creator.ts)
type BatchMsg = {
  chapterTitle: string;
  images: Array<{ filename: string; data: number[] }>;
  coverImage?: { data: number[]; extension: string };
  comicInfoXml?: string;
  extension: 'cbz' | 'zip';
};

type InboundMsg = InitMsg | AddComicInfoMsg | AddCoverMsg | AddImageMsg | FinalizeMsg | ResetMsg | BatchMsg;

export type ZipWorkerResponse =
  | {
      success: true;
      filename: string;
      size: number;
      buffer: ArrayBuffer; // transferable
      imageCount: number;
      format: 'cbz' | 'zip';
    }
  | { success: false; error: string };

interface StreamingState {
  zip?: Zip;
  chunks: Uint8Array[];
  isFinalized: boolean;
  chapterTitle?: string;
  extension?: 'cbz' | 'zip';
  imageCount: number;
  // Normalization state
  normalizeImageFilenames: boolean;
  imagePaddingDigits: 'auto' | 2 | 3 | 4 | 5;
  totalImages: number;
}

const streamState: StreamingState = {
  chunks: [],
  isFinalized: false,
  imageCount: 0,
  normalizeImageFilenames: false,
  imagePaddingDigits: 'auto',
  totalImages: 0,
};

function post(message: ZipWorkerResponse, transfer?: Transferable[]) {
  (self as unknown as { postMessage: (msg: ZipWorkerResponse, transfer?: Transferable[]) => void }).postMessage(message, transfer);
}

function formatWorkerError(error: unknown, context: string): string {
  if (error instanceof Error) {
    return `${context}: ${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ''}`;
  }

  if (typeof error === 'string' && error.length > 0) {
    return `${context}: ${error}`;
  }

  return `${context}: ${String(error)}`;
}

self.addEventListener('error', (event) => {
  const location = event.filename
    ? ` (${event.filename}:${event.lineno}:${event.colno})`
    : '';
  const error = event.error instanceof Error
    ? event.error
    : new Error(`${event.message || 'Unhandled worker error'}${location}`);
  post({ success: false, error: formatWorkerError(error, 'Zip worker global error') });
  event.preventDefault();
});

self.addEventListener('unhandledrejection', (event) => {
  post({ success: false, error: formatWorkerError(event.reason, 'Zip worker unhandled rejection') });
  event.preventDefault();
});

function ensureZip(): Zip {
  if (!streamState.zip) {
    streamState.zip = new Zip();
    streamState.zip.ondata = (err, chunk, final) => {
      if (err) {
        post({ success: false, error: err.message || 'ZIP compression error' });
        return;
      }
      streamState.chunks.push(chunk);
      if (final) {
        const totalLength = streamState.chunks.reduce((sum, c) => sum + c.length, 0);
        const finalBuffer = new Uint8Array(totalLength);
        let offset = 0;
        for (const c of streamState.chunks) {
          finalBuffer.set(c, offset);
          offset += c.length;
        }
        const filename = `${streamState.chapterTitle || 'chapter'}.${streamState.extension || 'cbz'}`;
        const buffer = finalBuffer.buffer.slice(finalBuffer.byteOffset, finalBuffer.byteOffset + finalBuffer.byteLength);
        const res: ZipWorkerResponse = {
          success: true,
          filename,
          size: buffer.byteLength,
          buffer,
          imageCount: streamState.imageCount,
          format: (streamState.extension || 'cbz'),
        };
        post(res, [buffer]);
        streamState.isFinalized = true;
      }
    };
  }
  return streamState.zip;
}

function resetState() {
  streamState.zip = undefined;
  streamState.chunks = [];
  streamState.isFinalized = false;
  streamState.chapterTitle = undefined;
  streamState.extension = undefined;
  streamState.imageCount = 0;
  streamState.normalizeImageFilenames = false;
  streamState.imagePaddingDigits = 'auto';
  streamState.totalImages = 0;
}

/**
 * Handle batch API request (used by archive-creator.ts)
 * Processes all data in one go including cover image support
 */
function handleBatchAPI(msg: BatchMsg) {
  resetState();
  streamState.chapterTitle = msg.chapterTitle;
  streamState.extension = msg.extension;
  const zip = ensureZip();
  
  // Add ComicInfo.xml first if provided
  if (msg.comicInfoXml) {
    const comicInfoStream = new AsyncZipDeflate('ComicInfo.xml', { level: 6 });
    zip.add(comicInfoStream);
    comicInfoStream.push(strToU8(msg.comicInfoXml), true);
  }
  
  // Add cover image as first file (000_cover.ext) if provided
  if (msg.coverImage && msg.coverImage.data.length > 0) {
    const coverBytes = new Uint8Array(msg.coverImage.data);
    const coverFilename = `000_cover.${msg.coverImage.extension}`;
    const coverStream = new AsyncZipDeflate(coverFilename, { level: 6 });
    zip.add(coverStream);
    coverStream.push(coverBytes, true);
    logger.debug(`🖼️ Added cover to archive: ${coverFilename}`);
  }
  
  // Add all chapter images
  for (const img of msg.images) {
    if (img.data && img.data.length > 0) {
      const bytes = new Uint8Array(img.data);
      const stream = new AsyncZipDeflate(img.filename, { level: 6 });
      zip.add(stream);
      stream.push(bytes, true);
      streamState.imageCount++;
    }
  }
  
  // Finalize
  zip.end();
}

self.onmessage = (ev: MessageEvent<InboundMsg>) => {
  const msg = ev.data;
  try {
    // Handle batch API (no 'type' field, used by archive-creator.ts)
    if ('chapterTitle' in msg && !('type' in msg)) {
      handleBatchAPI(msg);
      return;
    }
    
    // Handle streaming API (has 'type' field)
    switch (msg.type) {
      case 'reset': {
        resetState();
        return;
      }
      case 'init': {
        resetState();
        const { chapterTitle, extension, normalizeImageFilenames, imagePaddingDigits, totalImages } = msg;
        streamState.chapterTitle = chapterTitle;
        streamState.extension = extension;
        // Store normalization settings
        streamState.normalizeImageFilenames = normalizeImageFilenames ?? false;
        streamState.imagePaddingDigits = imagePaddingDigits ?? 'auto';
        streamState.totalImages = totalImages ?? 0;
        ensureZip();
        return;
      }
      case 'addComicInfo': {
        const zip = ensureZip();
        const stream = new AsyncZipDeflate('ComicInfo.xml', { level: 6 });
        zip.add(stream);
        stream.push(strToU8(msg.xml), true);
        return;
      }
      case 'addCover': {
        // Add cover image as first file (000_cover.ext)
        const zip = ensureZip();
        const bytes = new Uint8Array(msg.buffer);
        if (bytes.byteLength > 0) {
          const coverFilename = `000_cover.${msg.extension}`;
          const cover = new AsyncZipDeflate(coverFilename, { level: 6 });
          zip.add(cover);
          cover.push(bytes, true);
          // Note: Don't increment imageCount for cover, it's tracked separately
          logger.debug(`🖼️ Added cover to archive: ${coverFilename}`);
        }
        return;
      }
      case 'addImage': {
        const zip = ensureZip();
        const bytes = new Uint8Array(msg.buffer);
        if (bytes.byteLength > 0) {
          // Determine filename based on normalization setting
          let filename = msg.filename;
          
          if (streamState.normalizeImageFilenames && msg.index !== undefined && msg.mimeType) {
            // Use normalized filename (001.jpg, 002.png, etc.)
            filename = normalizeImageFilename(
              msg.index,
              streamState.totalImages,
              msg.mimeType,
              streamState.imagePaddingDigits
            );
          }
          
          const img = new AsyncZipDeflate(filename, { level: 6 });
          zip.add(img);
          img.push(bytes, true);
          streamState.imageCount++;
        }
        return;
      }
      case 'finalize': {
        const zip = ensureZip();
        zip.end();
        return;
      }
    }
  } catch (error) {
    const messageType = 'type' in msg ? msg.type : 'batch';
    post({ success: false, error: formatWorkerError(error, `Zip worker ${messageType}`) });
  }
};

