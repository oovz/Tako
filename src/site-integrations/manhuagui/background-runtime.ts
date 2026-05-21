import type {
  BackgroundSiteAdapter,
  ServiceWorkerIntegration,
} from '@/src/types/site-integrations'
import { prepareManhuaguiDispatchContext } from './dispatch-context'

const background: ServiceWorkerIntegration = {
  name: 'Manhuagui Background',
  prepareDispatchContext: prepareManhuaguiDispatchContext,
}

export const backgroundSiteAdapter: BackgroundSiteAdapter = {
  id: 'manhuagui',
  background,
}
