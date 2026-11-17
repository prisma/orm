import type { Contract } from '@internal/contract/types';
import type { Namespace } from '@internal/framework-components/ir';
import type { SqlNamespaceInput, SqlStorage } from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import { SqlContractSerializerBase } from '../src/core/ir/sql-contract-serializer-base';

/**
 * SQL contract serializer for tests that don't require a target-specific namespace concretion.
 * Uses `TestSqlNamespace` when hydrating namespace entries from plain JSON objects.
 * Production paths always supply a target-specific serializer (e.g. `PostgresContractSerializer`).
 */
export class TestSqlContractSerializer extends SqlContractSerializerBase<Contract<SqlStorage>> {
  constructor() {
    super(new Map());
  }

  protected override hydrateSqlNamespaceEntry(
    nsId: string,
    raw: Record<string, unknown>,
  ): Namespace | SqlNamespaceInput {
    return createTestSqlNamespace(
      blindCast<
        SqlNamespaceInput,
        'raw is always plain JSON, so super.hydrateSqlNamespaceEntry returns SqlNamespaceInput'
      >(super.hydrateSqlNamespaceEntry(nsId, raw)),
    );
  }
}
