import type { Contract } from '@internal/contract/types';
import {
  controlPolicyForCall,
  type ResolvedHints,
  type ResolvedTableRename,
  type SuppressionRecord,
} from '@internal/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type { ConsumedHint } from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { PostgresDatabaseSchemaNode } from '../schema-ir/postgres-database-schema-node';
import { resolvePostgresCallControlPolicySubject } from './control-policy';
import { RenameTableCall } from './op-factory-call';
import { emissionSchemaForNamespace, postgresTableRenameCall } from './table-rename-calls';
import { createWorkingSchema } from './working-schema';

export interface HintRenames {
  readonly calls: readonly RenameTableCall[];
  /** The origin with every planned rename applied: the schema the rest of the plan diffs. */
  readonly adjustedOrigin: PostgresDatabaseSchemaNode;
  readonly consumed: readonly ConsumedHint[];
  /** The table renames applied, in order. */
  readonly renames: readonly ResolvedTableRename[];
  readonly warnings: readonly SuppressionRecord[];
}

/**
 * Turns the resolved table renames into rename calls, in order, each computed against the origin as
 * the earlier renames leave it. A rename onto a table whose effective control policy is not
 * `managed` cannot be planned: it is skipped with a suppression warning, and the old table is left
 * to the rest of the plan.
 */
export function planHintRenames(input: {
  readonly origin: PostgresDatabaseSchemaNode;
  readonly contract: Contract<SqlStorage>;
  readonly hints: Pick<ResolvedHints, 'tableRenames'>;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}): HintRenames {
  const { contract } = input;
  const working = createWorkingSchema(input.origin);
  const calls: RenameTableCall[] = [];
  const consumed: ConsumedHint[] = [];
  const renames: ResolvedTableRename[] = [];
  const warnings: SuppressionRecord[] = [];
  for (const rename of input.hints.tableRenames) {
    const wouldBe = new RenameTableCall(
      emissionSchemaForNamespace(contract, rename.namespaceId),
      rename.from,
      rename.to,
      [],
    );
    const subject = resolvePostgresCallControlPolicySubject(wouldBe, contract);
    const policy = controlPolicyForCall(subject, contract.defaultControlPolicy);
    if (policy !== 'managed') {
      warnings.push({ subject, policy, factoryName: wouldBe.factoryName, createsNewObject: false });
      continue;
    }
    const call = postgresTableRenameCall({
      previous: working.current,
      contract,
      rename,
      frameworkComponents: input.frameworkComponents,
    });
    working.apply(call);
    calls.push(call);
    renames.push(rename);
    consumed.push({
      kind: 'renamed',
      coordinate: { namespaceId: rename.namespaceId, entityKind: 'table', entityName: rename.to },
      from: rename.from,
    });
  }
  return { calls, adjustedOrigin: working.current, consumed, renames, warnings };
}
