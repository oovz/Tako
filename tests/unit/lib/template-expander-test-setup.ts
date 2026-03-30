import { beforeEach } from 'vitest'
import { createMockContext, type TemplateContext } from '@/src/shared/template-expander'

let mockContext: TemplateContext

export function useTemplateExpanderTestContext(): () => TemplateContext {
  beforeEach(() => {
    mockContext = createMockContext()
  })

  return () => mockContext
}
