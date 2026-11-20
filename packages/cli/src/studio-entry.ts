import { createStudioBFFClient } from '@prisma/studio-core/data/bff'
import { createMySQLAdapter } from '@prisma/studio-core/data/mysql-core'
import { createPostgresAdapter } from '@prisma/studio-core/data/postgres-core'
import { createSQLiteAdapter } from '@prisma/studio-core/data/sqlite-core'
import { Studio, type StudioProps } from '@prisma/studio-core/ui'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'

import { isStudioAdapterType, type StudioAdapterType, type StudioConfig } from './studio-frontend-shared'

const ADAPTER_FACTORIES = {
  mysql: createMySQLAdapter,
  postgres: createPostgresAdapter,
  sqlite: createSQLiteAdapter,
} satisfies Record<
  StudioAdapterType,
  (options: { executor: ReturnType<typeof createStudioBFFClient> }) => NonNullable<StudioProps['adapter']>
>

function getStudioConfig(): StudioConfig {
  const config = (window as Window & { __STUDIO_CONFIG__?: Partial<StudioConfig> }).__STUDIO_CONFIG__

  if (config && isStudioAdapterType(config.adapter)) {
    return { adapter: config.adapter }
  }

  throw new Error('Invalid Prisma Studio frontend config.')
}

function getRootElement(): HTMLElement {
  const rootElement = document.getElementById('root')

  if (rootElement instanceof HTMLElement) {
    return rootElement
  }

  throw new Error('Prisma Studio root element was not found.')
}

const createAdapter = ADAPTER_FACTORIES[getStudioConfig().adapter]
const adapter = createAdapter({
  executor: createStudioBFFClient({ url: '/bff' }),
})

const onEvent = (event: Parameters<NonNullable<StudioProps['onEvent']>>[0]) => {
  void fetch('/telemetry', {
    body: JSON.stringify(event),
    method: 'POST',
  }).catch(() => {
    // noop
  })
}

;(window as Window & { __PVCE__?: boolean }).__PVCE__ = true

createRoot(getRootElement()).render(createElement(Studio, { adapter, onEvent }))
