import type {
  BackgroundSiteAdapter,
  ServiceWorkerIntegration,
} from '@/src/types/site-integrations'

const background: ServiceWorkerIntegration = {
  name: 'Shonen Jump+ Background',
}

export const backgroundSiteAdapter: BackgroundSiteAdapter = {
  id: 'shonenjumpplus',
  background,
}
