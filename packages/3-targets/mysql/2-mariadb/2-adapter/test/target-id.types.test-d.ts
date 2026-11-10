import type { SqlControlAdapterDescriptor } from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import { expectTypeOf, test } from 'vitest';
import mariadbAdapter from '../src/exports/control';

test('the MariaDB control adapter carries the MariaDB target id', () => {
  expectTypeOf(mariadbAdapter).toEqualTypeOf<SqlControlAdapterDescriptor<'mariadb'>>();
  expectTypeOf(mariadbAdapter.create).returns.toEqualTypeOf<SqlControlAdapter<'mariadb'>>();
});
