/**
 * Unit tests for download-path-validator.ts
 * Tests path validation logic for templates and resolved paths.
 */

import { registerValidationResultContractCases } from './download-path-validator-contract.cases';
import { registerValidateDownloadPathCases } from './download-path-validator-download-path.cases';
import { registerValidateResolvedPathCases } from './download-path-validator-resolved-path.cases';

registerValidateDownloadPathCases();
registerValidateResolvedPathCases();
registerValidationResultContractCases();

