import { useEffect, useState } from "react"
import type {
  PersistentError,
  PersistentErrorSeverity,
} from "@/src/runtime/persistent-error-schema"
import {
  acknowledgePersistentError,
  subscribePersistentErrors,
} from "./useErrors-subscription"

export type UIPersistentErrorSeverity = PersistentErrorSeverity
export type UIPersistentError = PersistentError

export function useErrors() {
  const [errors, setErrors] = useState<UIPersistentError[]>([])
  useEffect(() => subscribePersistentErrors(setErrors), [])
  return { errors, acknowledgeError: acknowledgePersistentError }
}
