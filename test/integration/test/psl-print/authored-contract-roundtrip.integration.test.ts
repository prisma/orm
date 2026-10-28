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
} from './print-and-read-back';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

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
    name: 'value objects with nested, list, enum and self-referring members, and a discriminator, each with its derived check',
    schema: readFileSync(
      join(
        repoRoot,
        'test/integration/test/sql-orm-client/fixtures/value-object-checks/contract.prisma',
      ),
      'utf-8',
    ).replace('// use prisma-8\n', ''),
  },
  {
    name: 'a value object field of a variant that shares the base table, whose column is nullable',
    schema: `type Geo {
  lat Float
  lng Float
}

model Shape {
  id   Int    @id
  kind String

  @@discriminator(kind)
}

model Circle {
  center Geo

  @@base(Shape, "circle")
}

model Square {
  side Int

  @@base(Shape, "square")
}
`,
  },
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
  @@index([id], where: sql\`id > 10\`, name: "doc_recent")
  @@index(expression: sql\`lower(body)\`, name: "doc_body_lower")
  @@index([tags], unique: true, name: "doc_tags_key")
}
`,
  },
  {
    name: 'full-text indexes: one field, weight groups, a language, a predicate and an exact name',
    schema: `model Post {
  id       Int     @id
  title    String
  subtitle String? @map("sub_title")
  body     String?

  @@fullTextIndex([title], name: "post_title_search")
  @@fullTextIndex([[title, subtitle], body], name: "post_search")
  @@fullTextIndex([body, title], language: "german", where: sql\`id > 10\`, name: "post_search_de")
  @@fullTextIndex([[body]], map: "legacy_body_search")
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
  using  = sql\`owner_id = current_setting('app.uid')::int\`
}

policy_insert p_write {
  target    = Profile
  roles     = [app_user]
  withCheck = sql\`owner_id > 0\`
}

policy_update p_update {
  target     = Profile
  roles      = [admin]
  using      = sql\`true\`
  withCheck  = sql\`owner_id > 0\`
  permissive = false
}

policy_all p_admin {
  target = Profile
  roles  = [admin]
  using  = sql\`true\`

  @@map("profile_admin_policy")
}
`,
  },
  {
    name: 'a policy whose target and role are qualified by another namespace',
    schema: `namespace unbound {
  role auditor {
  }
}

namespace auth {
  model Account {
    id Int @id

    @@rls
  }
}

policy_select p_read {
  target = auth.Account
  roles  = [unbound.auditor]
  using  = sql\`true\`
}
`,
  },
  {
    name: 'a check written with a name prefix',
    schema: `model Widget {
  id    Int    @id
  email String

  @@check(expression: sql\`length(email) > 0\`, name: "widget_email_not_blank")
  @@check(expression: sql\`id > 0\`, map: "widget_id_positive")
}
`,
  },
  {
    name: 'a value object nested in another, a list of nested value objects, and an enum member',
    schema: `enum Country {
  @@type("pg/text@1")
  DE = "DE"
  FR = "FR"
}

type Geo {
  lat Float
  lng Float
}

type Address {
  street  String
  country Country
  geo     Geo
  stops   Geo[]
}

model Person {
  id    Int       @id
  home  Address
  homes Address[]
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
    name: 'defaults on a value object and on a list of value objects',
    schema: `type Address {
  street String
  zip    String?
}

model Person {
  id    Int       @id
  home  Address   @default(json\`{"street": "x"}\`)
  homes Address[] @default([])
  addrs Address[] @default(json\`[{"street": "y", "zip": null}]\`)
}
`,
  },
  {
    name: 'value-object members with type parameters, single and list',
    schema: `type Price {
  amount  Numeric(65, 30)
  history Numeric(65, 30)[]
}

model Product {
  id    Int   @id
  price Price
}
`,
  },
  {
    name: 'value-object members typed by a domain enum, single and list, written back by enum name',
    schema: `enum Country {
  @@type("pg/text@1")
  DE = "DE"
  FR = "FR"
}

type Address {
  country   Country
  countries Country[]
}

model Person {
  id   Int     @id
  home Address
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
  using  = sql"owner = 'a\\"b' OR owner ~ '\\\\d'\\nOR owner = 'c'"
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
  using  = sql"owner = 'a\\tb\\u0001'"
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
    name: 'enum members that are not text: numbers, NaN and infinities, dates and times, an interval, an address, a uuid, and bare members',
    schema: `enum Level {
  @@type("pg/int4@1")
  Low  = 1
  High = 2
}

enum Ratio {
  @@type("pg/numeric@1")
  Half  = 0.5
  Whole = 1.50
}

enum Reading {
  @@type("pg/float8@1")
  Nan      = NaN
  Up       = Infinity
  Down     = -Infinity
  Fraction = 2.25
}

enum Launch {
  @@type("pg/date-temporal@1")
  First = date\`2024-01-02\`
}

enum Instant {
  @@type("pg/timestamptz-temporal@1")
  Start = timestamptz\`2024-01-02T03:04:05.5Z\`
}

enum Slot {
  @@type("pg/time-temporal@1")
  Morning = time\`03:04:05.5\`
}

enum Span {
  @@type("pg/interval@1")
  Day  = interval\`P1D\`
  Hour = interval\`PT1H\`
}

enum Network {
  @@type("pg/inet@1")
  Private = "10.0.0.0/8"
}

enum Key {
  @@type("pg/uuid@1")
  Only = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
}

enum Color {
  Red
  Green
}

model Sample {
  id      Int      @id
  level   Level
  ratio   Ratio
  reading Reading
  launch  Launch
  instant Instant
  slot    Slot
  span    Span
  network Network
  key     Key
  color   Color
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

describe('a native enum value "__proto__"', () => {
  it(
    'is written under a member name the PSL source keeps, and reads back',
    async () => {
      const authored = await readPsl(`// use prisma-8
namespace public {
  native_enum Mood {
    proto = "__proto__"
    calm  = "calm"
  }

  model Person {
    id   Int           @id
    mood pg.enum(Mood)
  }
}
`);
      const printed = await printAndReadBack(authored);

      expect(printContract(authored).text).toContain('= "__proto__"');
      expect(serializedWithoutCapabilities(printed)).toEqual(
        serializedWithoutCapabilities(authored),
      );
    },
    timeouts.pslRoundTrip,
  );
});

describe('a value-object member typed by a named type', () => {
  it(
    'is written with the named type inline, and reads back',
    async () => {
      const authored = await readPsl(`// use prisma-8
types {
  Short = VarChar(10)
}

type Label {
  code  Short
  codes Short[]
}

model Product {
  id    Int   @id
  code  Short
  label Label
}
`);
      const printed = await printAndReadBack(authored);

      expect(printContract(authored).text).toMatch(
        /type Label \{\s+code\s+VarChar\(10\)\s+codes\s+VarChar\(10\)\[\]/,
      );
      expect(serializedWithoutCapabilities(printed)).toEqual(
        serializedWithoutCapabilities(authored),
      );
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
