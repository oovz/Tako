import { registerNormalizeImageFilenameCases } from './filename-sanitizer-image-filenames.cases';
import { registerMimeTypeExtensionCases } from './filename-sanitizer-mime-types.cases';
import { registerSanitizeFilenameCases } from './filename-sanitizer-sanitize.cases';

registerSanitizeFilenameCases();
registerNormalizeImageFilenameCases();
registerMimeTypeExtensionCases();

