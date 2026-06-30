import type {
  BackgroundSiteAdapter,
  ServiceWorkerIntegration,
} from '@/src/types/site-integrations'

// No SW-side API calls needed for Shonen Jump+ — the content script extracts
// all series metadata and chapter data from the page DOM. This adapter exists
// to satisfy the BackgroundSiteAdapter interface shape required by the registry.
const background: ServiceWorkerIntegration = {
  name: 'Shonen Jump+ Background',
}

export const backgroundSiteAdapter: BackgroundSiteAdapter = {
  id: 'shonenjumpplus',
  background,
}
