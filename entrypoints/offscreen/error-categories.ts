import type { ErrorCategory } from './chapter-processing'

export function classifyOffscreenErrorCategory(error: unknown): ErrorCategory {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase()
  if (
    msg.includes('timeout') || msg.includes('abort') || msg.includes('network')
    || msg.includes('dns') || msg.includes('unreachable') || msg.includes('offline')
    || msg.includes('econn') || msg.includes('enet') || msg.includes('fetch')
    || msg.includes('failed to fetch')
  ) {
    return 'network'
  }
  if (
    msg.startsWith('http ') || msg.includes('image download failed')
    || msg.includes('no images found') || msg.includes('archive creation failed')
  ) {
    return 'download'
  }
  return 'other'
}
