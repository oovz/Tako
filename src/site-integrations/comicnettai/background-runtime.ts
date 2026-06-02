import type { BackgroundSiteAdapter, ServiceWorkerIntegration } from '@/src/types/site-integrations'

const background: ServiceWorkerIntegration = {
  name: 'Comic Nettai Background',
}

export const backgroundSiteAdapter: BackgroundSiteAdapter = {
  id: 'comicnettai',
  background,
}
