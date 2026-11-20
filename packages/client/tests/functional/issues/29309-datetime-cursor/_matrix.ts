import { defineMatrix } from '../../_utils/defineMatrix'
import { Providers, sqlProviders } from '../../_utils/providers'

export default defineMatrix(() => [sqlProviders.filter(({ provider }) => provider !== Providers.SQLITE)])
