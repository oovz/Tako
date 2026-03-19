/**
 * ImportExportDialog - Dialog for JSON import/export of settings
 */

import { useState, type ChangeEvent } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Download, Upload } from "lucide-react"
import { toast } from "sonner"
import { settingsService } from "@/src/storage/settings-service"
import { siteOverridesService } from "@/src/storage/site-overrides-service"
import { settingsExportSchema, type SettingsExport } from "../validation"
import logger from '@/src/runtime/logger'

interface ImportExportDialogProps {
  onImportComplete?: () => void
}

export function ImportExportDialog({ onImportComplete }: ImportExportDialogProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)

  const handleExport = async () => {
    setIsExporting(true)
    try {
      const settings = await settingsService.getSettings()
      const overrides = await siteOverridesService.getAll()
      
      const exportData: SettingsExport = {
        settings,
        overrides: Object.keys(overrides).length > 0 ? overrides : undefined
      }

      const json = JSON.stringify(exportData, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
      const filename = `tako-settings-${timestamp}.json`
      
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      
      URL.revokeObjectURL(url)
      
      toast.success('Settings exported successfully', {
        description: `Saved as ${filename}`
      })
    } catch (error) {
      logger.error('Export error:', error)
      toast.error('Failed to export settings', {
        description: error instanceof Error ? error.message : 'Unknown error'
      })
    } finally {
      setIsExporting(false)
    }
  }

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setIsImporting(true)
    try {
      const text = await file.text()
      const json: unknown = JSON.parse(text)
      
      // Validate with Zod schema
      const validation = settingsExportSchema.safeParse(json)
      if (!validation.success) {
        const errorMessages = validation.error.issues.map(issue => issue.message).join(', ')
        throw new Error(`Invalid settings file: ${errorMessages}`)
      }

      const data = validation.data

      await settingsService.updateSettings(data.settings)
      
      // Apply overrides if present
      if (data.overrides) {
        await siteOverridesService.setAll(data.overrides)
      }

      toast.success('Settings imported successfully', {
        description: 'All settings have been applied'
      })
      
      setIsOpen(false)
      onImportComplete?.()
    } catch (error) {
      logger.error('Import error:', error)
      toast.error('Failed to import settings', {
        description: error instanceof Error ? error.message : 'Invalid file format'
      })
    } finally {
      setIsImporting(false)
      // Reset file input
      event.target.value = ''
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Download className="mr-2 h-4 w-4" />
          Import/Export
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import/Export Settings</DialogTitle>
          <DialogDescription>
            Export your settings to a JSON file or import from a previously exported file.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Export Settings</h4>
            <p className="text-sm text-muted-foreground">
              Download all your settings and site overrides as a JSON file. 
              You can use this to backup or transfer settings between devices.
            </p>
            <Button 
              onClick={handleExport} 
              disabled={isExporting}
              className="w-full"
            >
              {isExporting ? (
                <>
                  <Download className="mr-2 h-4 w-4 animate-pulse" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  Export Settings
                </>
              )}
            </Button>
          </div>

          <div className="border-t pt-4 space-y-2">
            <h4 className="text-sm font-medium">Import Settings</h4>
            <p className="text-sm text-muted-foreground">
              Select a previously exported JSON file to restore settings.
              This will overwrite your current settings.
            </p>
            <div className="flex items-center gap-2">
              <Button 
                variant="secondary"
                className="w-full"
                disabled={isImporting}
                onClick={() => document.getElementById('import-file-input')?.click()}
              >
                {isImporting ? (
                  <>
                    <Upload className="mr-2 h-4 w-4 animate-pulse" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />
                    Choose File to Import
                  </>
                )}
              </Button>
              <input
                id="import-file-input"
                type="file"
                accept=".json,application/json"
                onChange={handleImport}
                className="hidden"
              />
            </div>
          </div>

          <div className="rounded-md bg-muted p-3 text-xs space-y-1">
            <p className="font-medium">What's included:</p>
            <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
              <li>Global settings (downloads, UI, advanced)</li>
              <li>Rate limiting policies</li>
              <li>Site-specific overrides</li>
              <li>All preferences and configurations</li>
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

