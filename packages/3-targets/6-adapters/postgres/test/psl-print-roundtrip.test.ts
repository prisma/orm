import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { timeouts } from '@repo/test-utils';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';
import {
  printAndReadBack,
  printContract,
  readPsl,
  serializedWithoutCapabilities,
} from './helpers/psl-print';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../../..');

/**
 * Emitted contract fixtures, one per feature a Prisma 7 schema cannot carry.
 * Each is printed as PSL, read back, and must come back as the same contract.
 */
const cases: ReadonlyArray<{ readonly name: string; readonly contractJson: string }> = [
  {
    name: 'value objects',
    contractJson: 'test/integration/test/value-objects/fixtures/generated/sql-contract.json',
  },
  {
    name: 'polymorphism: discriminator, base, variants and relations',
    contractJson:
      'test/integration/test/sql-orm-client/fixtures/polymorphism/generated/contract.json',
  },
  {
    name: 'the Supabase contract: row-level security, policies and roles across schemas, and a default control policy the config sets',
    contractJson: 'packages/3-extensions/supabase/src/contract/contract.json',
  },
  {
    name: 'named types and typeRef columns',
    contractJson:
      'test/integration/test/ports/prisma/functional/decimal-list/_fixture/generated/contract.json',
  },
];

function loadContract(relativePath: string): Contract<SqlStorage> {
  const json: unknown = JSON.parse(readFileSync(join(repoRoot, relativePath), 'utf-8'));
  return new PostgresContractSerializer().deserializeContract(json);
}

/**
 * Contracts authored in PSL, one per feature the emitted fixtures above do not
 * carry. Each is read, printed, read back, and compared.
 */
const pslCases: ReadonlyArray<{ readonly name: string; readonly schema: string }> = [
  {
    name: 'a model control policy',
    schema: `model Ledger {
  id Int @id

  @@control(external)
}
`,
  },
  {
    name: 'an index with a predicate, a type, options and an expression',
    schema: `model Doc {
  id   Int    @id
  body String
  tags String[]

  @@index([body], type: "gin", options: { fastupdate: "off" }, name: "doc_body_gin")
  @@index([id], where: "id > 10", name: "doc_recent")
  @@index(expression: "lower(body)", name: "doc_body_lower")
  @@index([tags], unique: true, name: "doc_tags_key")
}
`,
  },
  {
    name: 'a domain enum with membership checks on a scalar and a list column',
    schema: `enum Priority {
  @@type("pg/text@1")
  Low  = "low"
  High = "high"
}

model Task {
  id         Int        @id
  priority   Priority
  priorities Priority[]
  waived     Priority   @noCheck(membership)
  preset     Priority   @default(Low)
}
`,
  },
  {
    name: 'primary key names',
    schema: `model Widget {
  id Int @id(map: "widget_pk")
}

model Pair {
  a Int
  b Int

  @@id([a, b], map: "pair_pk")
}
`,
  },
  {
    name: 'columns whose codec is not the default for their native type',
    schema: `model Clock {
  id    Int                  @id
  day   DateString
  local TimestampString(3)
  zoned TimestamptzString(3)
  js    TimestamptzJsDate(3)
  time  TimeString(3)
  big   BigIntNumber
  huge  UnboundedInt
}
`,
  },
  {
    name: 'row-level security: roles, @@rls, and policies with and without an exact name',
    schema: `namespace unbound {
  role app_user {
  }

  role admin {
  }
}

model Profile {
  id       Int @id
  owner_id Int

  @@rls
}

policy_select p_read {
  target = Profile
  roles  = [app_user, admin]
  using  = "owner_id = current_setting('app.uid')::int"
}

policy_insert p_write {
  target    = Profile
  roles     = [app_user]
  withCheck = "owner_id > 0"
}

policy_update p_update {
  target     = Profile
  roles      = [admin]
  using      = "true"
  withCheck  = "owner_id > 0"
  permissive = false
}

policy_all p_admin {
  target = Profile
  roles  = [admin]
  using  = "true"

  @@map("profile_admin_policy")
}
`,
  },
  {
    name: 'a check written with a name prefix',
    schema: `model Widget {
  id    Int    @id
  email String

  @@check(expression: "length(email) > 0", name: "widget_email_not_blank")
  @@check(expression: "id > 0", map: "widget_id_positive")
}
`,
  },
  {
    name: 'a list of value objects',
    schema: `type Address {
  street String
  city   String?
}

model Person {
  id    Int       @id
  home  Address
  addrs Address[]
}
`,
  },
  {
    name: 'a policy expression holding a quote, a backslash and a line break',
    schema: `namespace unbound {
  role app_user {
  }
}

model Note {
  id    Int    @id
  owner String

  @@rls
}

policy_select p_read {
  target = Note
  roles  = [app_user]
  using  = "owner = 'a\\"b' OR owner ~ '\\\\d'\\nOR owner = 'c'"
}
`,
  },
  {
    name: 'a policy expression holding a tab and another control character',
    schema: `namespace unbound {
  role app_user {
  }
}

model Note {
  id    Int    @id
  owner String

  @@rls
}

policy_select p_read {
  target = Note
  roles  = [app_user]
  using  = "owner = 'a\tb\u0001'"
}
`,
  },
  {
    name: 'enum member values holding a tab and a quote',
    schema: `enum Label {
  @@type("pg/text@1")
  Tabbed = "a\\tb"
  Quoted = "say \\"hi\\""
}

model Tagged {
  id    Int   @id
  label Label
}
`,
  },
  {
    name: 'a model in the unbound namespace',
    schema: `namespace unbound {
  model Setting {
    id Int @id
  }
}
`,
  },
];

describe('a printed PSL contract reads back as the same contract', () => {
  it.each(pslCases)(
    '$name',
    async ({ schema }) => {
      const authored = await readPsl(`// use prisma-8\n${schema}`);
      const printed = await printAndReadBack(authored);

      expect(serializedWithoutCapabilities(printed)).toEqual(
        serializedWithoutCapabilities(authored),
      );
      expect(printed.storage.storageHash).toBe(authored.storage.storageHash);
    },
    timeouts.pslRoundTrip,
  );
});

describe('a contract the language cannot carry is refused by name', () => {
  it('refuses a to-one relation that travels no foreign key', () => {
    const authored = loadContract(
      'test/integration/test/sql-orm-client/fixtures/generated/contract.json',
    );
    expect(() => printContract(authored)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PRINT_UNSUPPORTED',
        meta: { model: 'Article', field: 'reviewer' },
      }),
    );
  });

  it('refuses a relation to a Supabase model, which lives in another contract space', () => {
    expect(() => printContract(loadContract('examples/supabase/src/contract.json'))).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PRINT_UNSUPPORTED',
        meta: { model: 'Profile', field: 'user', space: 'supabase' },
      }),
    );
  });

  it('refuses a many-to-many relation whose junction model has no relation back to it', () => {
    const authored = loadContract(
      'test/integration/test/sql-orm-client/fixtures/junction-namespaces/generated/contract.json',
    );
    expect(() => printContract(authored)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PRINT_UNSUPPORTED',
        meta: { model: 'User', field: 'roles' },
      }),
    );
  });
});

describe('a printed emitted contract reads back as the same contract', () => {
  it.each(cases)(
    '$name',
    async ({ contractJson }) => {
      const authored = loadContract(contractJson);
      const printed = await printAndReadBack(authored);

      expect(serializedWithoutCapabilities(printed)).toEqual(
        serializedWithoutCapabilities(authored),
      );
      expect(printed.storage.storageHash).toBe(authored.storage.storageHash);
    },
    timeouts.pslRoundTrip,
  );
});
