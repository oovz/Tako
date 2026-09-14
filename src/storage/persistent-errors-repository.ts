import { LOCAL_STORAGE_KEYS } from "@/src/runtime/storage-keys"
import { InvalidDurableStateError } from "@/src/runtime/runtime-phase-errors"
import { StorageMutationQueue } from "@/src/storage/storage-mutation-queue"
import {
  PersistentErrorsSchema,
  type PersistentError,
  type PersistentErrorSeverity,
} from "@/src/runtime/persistent-error-schema"

type PersistentErrorInput = {
  code: string
  message: string
  severity?: PersistentErrorSeverity
  ts?: number
}

const PERSISTENT_ERRORS_STORAGE_KEY = LOCAL_STORAGE_KEYS.persistentErrors

export class PersistentErrorsRepository {
  private readonly mutations = new StorageMutationQueue()

  private async read(): Promise<PersistentError[]> {
    const result = await chrome.storage.local.get(PERSISTENT_ERRORS_STORAGE_KEY)
    if (!(PERSISTENT_ERRORS_STORAGE_KEY in result)) return []

    const parsed = PersistentErrorsSchema.safeParse(
      result[PERSISTENT_ERRORS_STORAGE_KEY]
    )
    if (!parsed.success) {
      throw new InvalidDurableStateError(
        "Invalid durable persistent error state",
        { cause: parsed.error }
      )
    }
    return parsed.data
  }

  private async write(errors: PersistentError[]): Promise<void> {
    await chrome.storage.local.set({ [PERSISTENT_ERRORS_STORAGE_KEY]: errors })
  }

  private async update(
    update: (existing: PersistentError[]) => PersistentError[]
  ): Promise<void> {
    await this.mutations.run(async () => {
      const existing = await this.read()
      await this.write(update(existing))
    })
  }

  async getAll(): Promise<PersistentError[]> {
    return await this.mutations.run(() => this.read())
  }

  async add(input: PersistentErrorInput): Promise<void> {
    const severity: PersistentErrorSeverity = input.severity ?? "error"
    const ts = input.ts ?? Date.now()
    await this.update((existing) => {
      const filtered = existing.filter((error) => error.code !== input.code)
      return [
        ...filtered,
        { code: input.code, message: input.message, severity, ts },
      ]
    })
  }

  async clear(code: string): Promise<void> {
    await this.update((existing) =>
      existing.filter((error) => error.code !== code)
    )
  }
}

export const persistentErrorsRepository = new PersistentErrorsRepository()
