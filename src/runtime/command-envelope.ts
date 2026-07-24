import type { CommandEnvelope } from "@/src/types/command-envelope"

export function createCommandEnvelope(): CommandEnvelope {
  return {
    commandId: crypto.randomUUID(),
    issuedAt: Date.now(),
  }
}
