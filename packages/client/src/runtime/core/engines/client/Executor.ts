import type { QueryPlanNode, TransactionOptions } from '@prisma/client-engine-runtime'
import type { ConnectionInfo, Provider } from '@prisma/driver-adapter-utils'
import type { SqlCommenterQueryInfo } from '@prisma/sqlcommenter'

import type { AccelerateExtensionFetch } from '../common/Engine'
import type { InteractiveTransactionInfo } from '../common/types/Transaction'

export interface ExecutePlanParams {
  plan: QueryPlanNode
  model: string | undefined
  operation: string
  placeholderValues: Record<string, unknown>
  transaction: InteractiveTransactionInfo | undefined
  batchIndex: number | undefined
  customFetch?: AccelerateExtensionFetch
  queryInfo: SqlCommenterQueryInfo
}

export interface ProviderAndConnectionInfo {
  provider: Provider
  connectionInfo: ConnectionInfo
}

export interface Executor {
  getConnectionInfo(): Promise<ProviderAndConnectionInfo>

  execute(params: ExecutePlanParams): Promise<unknown>

  startTransaction(options: TransactionOptions): Promise<InteractiveTransactionInfo>

  commitTransaction(transaction: InteractiveTransactionInfo): Promise<void>

  rollbackTransaction(transaction: InteractiveTransactionInfo): Promise<void>

  disconnect(): Promise<void>

  apiKey(): string | null
}
