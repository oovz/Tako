export function sanitizeLabel(raw: string): string {
  let cleaned = ''

  for (const char of raw) {
    const code = char.charCodeAt(0)
    const isControlChar = (code >= 0 && code <= 31) || code === 127
    cleaned += isControlChar ? ' ' : char
  }

  return cleaned.replace(/\s+/g, ' ').trim()
}

export function normalizeNumericText(value: string): string {
  return value.replace(/[０-９．]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
}

export function parseChapterNumber(label: string): number | undefined {
  const normalized = sanitizeLabel(label)
  if (!normalized) {
    return undefined
  }

  const parseable = normalizeNumericText(normalized)
  const match = parseable.match(/\d+(?:\.\d+)?/)
  if (!match) {
    return undefined
  }

  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : undefined
}

export function parseVolumeInfo(text: string): { volumeLabel?: string; volumeNumber?: number } {
  const label = sanitizeLabel(text)
  if (!label) {
    return {}
  }

  const parseable = normalizeNumericText(label)
  const match = parseable.match(/(?:vol(?:ume)?\.?\s*)?(\d+(?:\.\d+)?)/i)
  if (!match) {
    return { volumeLabel: label }
  }

  const parsedNumber = Number(match[1])
  return {
    volumeLabel: label,
    volumeNumber: Number.isFinite(parsedNumber) ? parsedNumber : undefined,
  }
}
