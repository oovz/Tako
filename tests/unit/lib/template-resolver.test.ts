/**
 * @file template-resolver.test.ts
 * @description Unit tests for download path template resolution
 * Covers: macro expansion, edge cases, validation, sanitization, all template variables
 */

import { registerTemplateResolverDirectoryCases } from './template-resolver-directory.cases';
import { registerTemplateResolverFilenameAndPreviewCases } from './template-resolver-filename-preview.cases';
import { registerTemplateResolverMacroUtilityCases } from './template-resolver-macro-utils.cases';

registerTemplateResolverDirectoryCases();
registerTemplateResolverFilenameAndPreviewCases();
registerTemplateResolverMacroUtilityCases();

