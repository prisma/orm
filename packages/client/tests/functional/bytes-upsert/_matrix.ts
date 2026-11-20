import { defineMatrix } from '../_utils/defineMatrix'
import { allProviders, Providers } from '../_utils/providers'

export default defineMatrix(() => [allProviders.filter(({ provider }) => provider !== Providers.SQLSERVER)])
