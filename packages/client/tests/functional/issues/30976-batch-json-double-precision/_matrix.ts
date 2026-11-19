import { defineMatrix } from '../../_utils/defineMatrix'
import { Providers } from '../../_utils/providers'

// PostgreSQL only: its `jsonb` keeps every double exactly. MySQL rounds some doubles when it
// parses JSON (for example, `CAST('{"a": 25.900000000000002}' AS JSON)` gives `{"a": 25.9}`),
// so it can't check the value Prisma sends.
export default defineMatrix(() => [[{ provider: Providers.POSTGRESQL }]])
