/**
 * Environment variable typings for WXT/Vite define replacements.
 * Ref: wxt.config.ts (import.meta.env.TMD_TEST_* definitions)
 */
interface ImportMetaEnv {
  readonly TMD_TEST_MANGADEX_DOMAIN?: string;
  readonly TMD_TEST_MANGADEX_API_BASE?: string;
  readonly TMD_TEST_MANGADEX_UPLOADS_BASE?: string;
  readonly TMD_TEST_MANGADEX_NETWORK_REPORT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
