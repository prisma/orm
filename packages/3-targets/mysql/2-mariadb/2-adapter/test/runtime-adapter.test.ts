import {
  ColumnRef,
  InsertAst,
  InsertOnConflict,
  ParamRef,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { createSqlExecutionStack } from '@internal/sql-runtime';
import mariadbRuntimeTarget from '@internal/target-mariadb/runtime';
import { describe, expect, it } from 'vitest';
import { mariadbAdapterCapabilities } from '../src/core/capabilities';
import mariadbRuntimeAdapter from '../src/core/runtime/runtime-adapter';

describe('the MariaDB runtime adapter', () => {
  it("carries the MariaDB target id, profile and capabilities, and lowers with MariaDB's renderer", () => {
    const adapter = mariadbRuntimeAdapter.create(
      createSqlExecutionStack({
        target: mariadbRuntimeTarget,
        adapter: mariadbRuntimeAdapter,
        extensions: [],
      }),
    );
    const upsert = InsertAst.into(TableSource.named('user'))
      .withRows([{ email: ParamRef.of('a@b.c') }])
      .withOnConflict(
        InsertOnConflict.on([]).doUpdateSet({ email: ColumnRef.of('excluded', 'email') }),
      );
    expect({
      targetId: adapter.targetId,
      profile: {
        id: adapter.profile.id,
        target: adapter.profile.target,
        capabilities: adapter.profile.capabilities,
      },
      sql: adapter.lower(upsert, { contract: undefined as never }).sql,
    }).toEqual({
      targetId: 'mariadb',
      profile: {
        id: 'mariadb/default@1',
        target: 'mariadb',
        capabilities: mariadbAdapterCapabilities,
      },
      sql: 'INSERT INTO `user` (`email`) VALUES (?1) ON DUPLICATE KEY UPDATE `email` = VALUES(`email`)',
    });
  });
});
