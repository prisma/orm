import type { PrismaNextConfig } from '@internal/config/config-types';
import { expectTypeOf, test } from 'vitest';
import { defineConfig } from '../src/config/define-config';
import type { Migration } from '../src/exports/migration';

test("MariaDB's defineConfig builds a config for the MariaDB target", () => {
  expectTypeOf(defineConfig).returns.toEqualTypeOf<PrismaNextConfig<'sql', 'mariadb'>>();
});

test("the MariaDB facade's Migration carries the MariaDB target id", () => {
  expectTypeOf<Migration['targetId']>().toEqualTypeOf<'mariadb'>();
});
