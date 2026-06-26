import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

let messages: Record<string, { message: string; placeholders?: Record<string, { content: string }> }> | null = null

function loadMessages() {
  if (messages) return messages
  const filePath = resolve(__dirname, '../../public/_locales/en/messages.json')
  const content = readFileSync(filePath, 'utf-8')
  messages = JSON.parse(content)
  return messages
}

function substitutePlaceholders(
  template: string,
  substitutions: string[],
  placeholders?: Record<string, { content: string }>,
): string {
  if (!placeholders) return template
  let result = template
  for (const [name, def] of Object.entries(placeholders)) {
    const token = `$${name.toUpperCase()}$`
    const index = parseInt(def.content.replace('$', ''), 10) - 1
    const value = substitutions[index] ?? ''
    result = result.replaceAll(token, value)
  }
  return result
}

function getMessageMock(key: string, substitutions?: string | string[]): string {
  const msgs = loadMessages()
  const entry = msgs[key]
  if (!entry) return key
  if (!substitutions) return entry.message
  const subs = Array.isArray(substitutions) ? substitutions : [substitutions]
  return substitutePlaceholders(entry.message, subs, entry.placeholders)
}

function getUILanguageMock(): string {
  return 'en'
}

if (!globalThis.chrome) {
  ;(globalThis as Record<string, unknown>).chrome = {}
}

const chromeMock = (globalThis as Record<string, { i18n?: Record<string, unknown> }>).chrome
if (!chromeMock.i18n) {
  chromeMock.i18n = {
    getMessage: getMessageMock,
    getUILanguage: getUILanguageMock,
  }
} else {
  if (!chromeMock.i18n.getMessage) {
    chromeMock.i18n.getMessage = getMessageMock
  }
  if (!chromeMock.i18n.getUILanguage) {
    chromeMock.i18n.getUILanguage = getUILanguageMock
  }
}
