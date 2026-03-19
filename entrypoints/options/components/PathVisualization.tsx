import { useMemo } from 'react'
import { AlertCircle, CheckCircle2 } from 'lucide-react'

import { createMockContext, expandTemplate, validateTemplate } from '@/src/shared/template-expander'

interface PathVisualizationProps {
  template: string
  filenameTemplate: string
}

export function PathVisualization({ template, filenameTemplate }: PathVisualizationProps) {
  const mockContext = useMemo(() => createMockContext(), [])

  const pathValidation = useMemo(() => validateTemplate(template), [template])
  const filenameValidation = useMemo(() => validateTemplate(filenameTemplate), [filenameTemplate])

  const pathResult = useMemo(() => {
    if (!pathValidation.valid) {
      return { success: false, expanded: '', errors: pathValidation.errors, warnings: [] }
    }
    return expandTemplate(template, mockContext)
  }, [template, pathValidation.valid, pathValidation.errors, mockContext])

  const filenameResult = useMemo(() => {
    if (!filenameValidation.valid) {
      return { success: false, expanded: '', errors: filenameValidation.errors, warnings: [] }
    }
    return expandTemplate(filenameTemplate, mockContext)
  }, [filenameTemplate, filenameValidation.valid, filenameValidation.errors, mockContext])

  const fullPath = useMemo(() => {
    if (!pathResult.success || !filenameResult.success) return null
    return `${pathResult.expanded}/${filenameResult.expanded}.cbz`
  }, [pathResult, filenameResult])

  const hasErrors = !pathResult.success || !filenameResult.success
  const hasWarnings = pathResult.warnings.length > 0 || filenameResult.warnings.length > 0

  return (
    <div className="rounded-md border border-border/50 bg-muted/20 p-3 space-y-2">
      <div className="flex items-start gap-2">
        {hasErrors ? (
          <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium mb-1">
            {hasErrors ? 'Invalid Template' : 'Preview Output'}
          </p>
          {fullPath ? (
            <p className="text-xs font-mono text-muted-foreground break-all">
              {fullPath}
            </p>
          ) : (
            <p className="text-xs text-destructive">
              {pathResult.errors.concat(filenameResult.errors).join('; ')}
            </p>
          )}
          {hasWarnings && (
            <p className="text-xs text-yellow-600 mt-1">
              ⚠️ {pathResult.warnings.concat(filenameResult.warnings).join('; ')}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

