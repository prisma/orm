import { defineMatrix } from '../../_utils/defineMatrix'
import { Providers } from '../../_utils/providers'

export default defineMatrix(() => [
  [
    {
      provider: Providers.SQLITE,
      relationMode: 'prisma',
    },
    {
      provider: Providers.MYSQL,
      relationMode: 'prisma',
    },
    {
      provider: Providers.POSTGRESQL,
      relationMode: 'prisma',
    },
  ],
])
