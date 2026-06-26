import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ExternalLink, RefreshCw, RotateCw, TriangleAlert } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  checkForChromeWebStoreUpdate,
  getChromeWebStoreUpdateStatusCopy,
  getCurrentExtensionVersion,
  getDefaultExtensionUpdateRuntime,
  reloadExtensionForUpdate,
  type ChromeWebStoreUpdateCheckResult,
} from '@/src/runtime/extension-update-check'
import {
  clearExtensionUpdateActionItem,
  markExtensionUpdateActionItemAvailable,
} from '@/src/runtime/options-action-items'
import { cn } from '@/src/shared/utils'
import { t } from '@/src/shared/i18n'

const CHROME_WEB_STORE_URL = 'https://chromewebstore.google.com/detail/tako-manga-downloader/hlodmckfkmbenkknmailfekehgajpmbb'

function statusClasses(tone: ReturnType<typeof getChromeWebStoreUpdateStatusCopy>['tone']): string {
  if (tone === 'success') return 'border-primary/30 bg-primary/5 text-foreground'
  if (tone === 'warning') return 'border-primary/30 bg-primary/5 text-foreground'
  if (tone === 'error') return 'border-destructive/40 bg-destructive/10 text-foreground'
  return 'border-border bg-muted/40 text-foreground'
}

function StatusIcon({ tone }: { tone: ReturnType<typeof getChromeWebStoreUpdateStatusCopy>['tone'] }) {
  if (tone === 'success') {
    return <CheckCircle2 aria-hidden="true" className="size-4 text-primary" />
  }

  return <TriangleAlert aria-hidden="true" className={cn('size-4', tone === 'error' ? 'text-destructive' : 'text-primary')} />
}

export function ExtensionUpdateSection() {
  const [currentVersion, setCurrentVersion] = useState(() => getCurrentExtensionVersion())
  const [lastResult, setLastResult] = useState<ChromeWebStoreUpdateCheckResult | null>(null)
  const [isChecking, setIsChecking] = useState(false)

  const statusCopy = useMemo(
    () => (lastResult ? getChromeWebStoreUpdateStatusCopy(lastResult) : null),
    [lastResult],
  )

  useEffect(() => {
    const runtime = getDefaultExtensionUpdateRuntime()
    setCurrentVersion(getCurrentExtensionVersion(runtime))

    if (!runtime?.onUpdateAvailable) return

    const handleUpdateAvailable = (details: chrome.runtime.UpdateAvailableDetails) => {
      const installedVersion = getCurrentExtensionVersion(runtime)
      setCurrentVersion(installedVersion)
      setLastResult({
        ok: true,
        status: 'update_available',
        currentVersion: installedVersion,
        availableVersion: details.version,
        checkedAt: Date.now(),
      })
      void markExtensionUpdateActionItemAvailable({ version: details.version })
    }

    runtime.onUpdateAvailable.addListener(handleUpdateAvailable)
    return () => runtime.onUpdateAvailable?.removeListener(handleUpdateAvailable)
  }, [])

  const handleCheckForUpdates = useCallback(async () => {
    setIsChecking(true)
    const result = await checkForChromeWebStoreUpdate()
    setCurrentVersion(result.currentVersion)
    setLastResult(result)
    if (result.ok && result.status === 'update_available') {
      await markExtensionUpdateActionItemAvailable({ version: result.availableVersion })
    } else if (result.ok && result.status === 'no_update') {
      await clearExtensionUpdateActionItem()
    }
    setIsChecking(false)
  }, [])

  const handleApplyUpdate = useCallback(() => {
    void clearExtensionUpdateActionItem().finally(() => {
      reloadExtensionForUpdate()
    })
  }, [])

  const canApplyUpdate = lastResult?.ok === true && lastResult.status === 'update_available'

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <RefreshCw aria-hidden="true" className="size-5 text-muted-foreground" />
          <CardTitle role="heading" aria-level={2} className="text-base">
            {t('options_chromeWebStoreUpdates')}
          </CardTitle>
        </div>
        <CardDescription>{t('options_chromeWebStoreUpdatesDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground" translate="no">
            {t('options_installedVersion', [currentVersion])}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleCheckForUpdates}
              disabled={isChecking}
            >
              <RotateCw aria-hidden="true" className={cn(isChecking && 'animate-spin')} />
              {isChecking ? t('options_checking') : t('options_checkForUpdates')}
            </Button>
            {canApplyUpdate && (
              <Button type="button" onClick={handleApplyUpdate}>
                <RefreshCw aria-hidden="true" />
                {t('options_applyUpdate')}
              </Button>
            )}
            <Button asChild variant="ghost">
              <a href={CHROME_WEB_STORE_URL} target="_blank" rel="noreferrer">
                <ExternalLink aria-hidden="true" />
                {t('options_openStoreListing')}
              </a>
            </Button>
          </div>
        </div>

        {statusCopy ? (
          <Alert className={statusClasses(statusCopy.tone)} aria-live="polite">
            <StatusIcon tone={statusCopy.tone} />
            <AlertTitle>{statusCopy.title}</AlertTitle>
            <AlertDescription>{statusCopy.description}</AlertDescription>
          </Alert>
        ) : (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {t('options_autoUpdateNote')}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
