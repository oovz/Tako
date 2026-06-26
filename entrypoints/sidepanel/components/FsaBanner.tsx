import React, { useCallback } from 'react'

import { AlertTriangle, Folder } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { openOptionsPage } from '@/src/runtime/open-options'
import { LOCAL_STORAGE_KEYS } from '@/src/runtime/storage-keys'
import { useChromeStorageValue } from '@/src/ui/shared/hooks/useChromeStorageValue'
import logger from '@/src/runtime/logger'

interface FsaErrorState {
  active?: boolean
  message?: string
}

interface FsaBannerProps {
  className?: string
}

function normalizeFsaErrorState(raw: unknown): FsaErrorState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }

  const candidate = raw as { active?: unknown; message?: unknown }
  return {
    active: candidate.active === true,
    message: typeof candidate.message === 'string' ? candidate.message : undefined,
  }
}

export function FsaBanner({ className }: FsaBannerProps) {
  const { value: fsaError } = useChromeStorageValue<FsaErrorState | null>({
    areaName: 'local',
    key: LOCAL_STORAGE_KEYS.fsaError,
    initialValue: null,
    parse: normalizeFsaErrorState,
  })

  const dismiss = useCallback(async () => {
    try {
      await chrome.runtime.sendMessage({
        type: 'ACKNOWLEDGE_ERROR',
        payload: { code: 'FSA_HANDLE_INVALID' },
      })
    } catch (error) {
      logger.debug('[FsaBanner] Failed to acknowledge FSA error (non-fatal):', error)
    }
  }, [])

  const openOptions = useCallback(async () => {
    try {
      await openOptionsPage('downloads')
    } catch (error) {
      logger.debug('[FsaBanner] Failed to open options (non-fatal):', error)
    }
  }, [])

  if (!fsaError?.active) {
    return null
  }

  return (
    <Alert variant="destructive" className={className}>
      <AlertTriangle className="size-4" />
      <AlertTitle>Custom download folder requires attention</AlertTitle>
      <AlertDescription className="flex items-start justify-between gap-3">
        <span>
          {fsaError.message || 'Your custom folder handle is invalid. Re-select a folder to continue using custom destination mode.'}
        </span>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={openOptions}>
            <Folder data-icon="inline-start" className="size-3.5" />
            Re-select
          </Button>
          <Button variant="ghost" size="sm" onClick={dismiss}>
            Dismiss
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}

