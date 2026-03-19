import React, { useCallback } from 'react'

import { AlertTriangle, Folder } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
    <Card className={className ?? 'border-destructive/40 bg-destructive/5'}>
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm font-medium text-destructive">Custom download folder requires attention</p>
            <p className="text-xs text-muted-foreground">
              {fsaError.message || 'Your custom folder handle is invalid. Re-select a folder to continue using custom destination mode.'}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={openOptions}>
              <Folder className="mr-1 h-3.5 w-3.5" />
              Re-select
            </Button>
            <Button variant="ghost" size="sm" onClick={dismiss}>
              <AlertTriangle className="mr-1 h-3.5 w-3.5" />
              Dismiss
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

