import type { BetterAuthOptions } from '@better-auth/core';
import type { DBFieldAttribute } from '@better-auth/core/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createWorkDir,
  emitContract,
  type SqlContract,
  type TargetName,
  targets,
  type WorkDir,
} from '../helpers/databases';
import { compare, pslForConfiguration, pslHeader } from '../helpers/printed-psl';

let workDir: WorkDir;
const emptyContracts = new Map<TargetName, SqlContract>();

beforeAll(async () => {
  workDir = await createWorkDir();
  for (const target of targets) {
    emptyContracts.set(target, (await emitContract(target, pslHeader, workDir)).contract);
  }
});

afterAll(() => workDir.remove());

function emptyContract(target: TargetName): SqlContract {
  const contract = emptyContracts.get(target);
  if (contract === undefined) throw new Error(`No empty ${target} contract`);
  return contract;
}

const declarations = `
type Address {
  street String
}

enum Status {
  active
  inactive
}
`;

const postgresDeclarations = `
native_enum NativeStatus {
  active = "active"
  inactive = "inactive"
}
`;

/** The problems the comparison reports when a probe model declares Better Auth's field `value` with the given PSL type. */
async function problemsFor(
  target: TargetName,
  attribute: DBFieldAttribute,
  pslType: string,
): Promise<unknown[]> {
  const options: BetterAuthOptions = {
    plugins: [{ id: 'probe', schema: { probe: { fields: { value: attribute } } } }],
  };
  const core = pslForConfiguration(emptyContract(target), {});
  const psl = `${core}${declarations}${target === 'postgres' ? postgresDeclarations : ''}
model Probe {
  id    String @id
  value ${pslType}

  @@map("probe")
}
`;
  const contract = (await emitContract(target, psl, workDir)).contract;
  return [...compare(contract, options).problems];
}

function wrongType(expectedType: string, found: string) {
  return [{ kind: 'wrong-type', model: 'Probe', field: 'value', expectedType, found }];
}

const codecs: Readonly<Record<TargetName, Readonly<Record<string, string>>>> = {
  sqlite: {
    Int: 'sqlite/integer@1',
    String: 'sqlite/text@1',
    BigInt: 'sqlite/bigint@1',
    Decimal: 'sqlite/decimal@1',
    Json: 'sqlite/json@1',
    'DateTime(as: temporal)': 'sqlite/datetime-temporal@1',
    'DateTime(as: string)': 'sqlite/datetime-string@1',
  },
  postgres: {
    Int: 'pg/int4@1',
    String: 'pg/text@1',
    BigInt: 'pg/int8@1',
    Decimal: 'pg/numeric@1',
    Json: 'pg/json@1',
    'DateTime(as: temporal)': 'pg/timestamptz-temporal@1',
    'DateTime(as: string)': 'pg/timestamptz-string@1',
  },
};

describe.each(targets)('field types on %s', (target) => {
  const codec = (pslType: string) => {
    const id = codecs[target][pslType];
    if (id === undefined) throw new Error(`No codec for ${pslType}`);
    return id;
  };

  it('a string accepts String and refuses Int and Decimal', async () => {
    const field: DBFieldAttribute = { type: 'string' };
    expect(await problemsFor(target, field, 'String')).toEqual([]);
    expect(await problemsFor(target, field, 'Int')).toEqual(wrongType('String', codec('Int')));
    expect(await problemsFor(target, field, 'Decimal')).toEqual(
      wrongType('String', codec('Decimal')),
    );
  });

  it('a list of allowed strings accepts String and an enum', async () => {
    const field: DBFieldAttribute = { type: ['active', 'inactive'] };
    expect(await problemsFor(target, field, 'String')).toEqual([]);
    expect(await problemsFor(target, field, 'Status')).toEqual([]);
    expect(await problemsFor(target, field, 'Int')).toEqual(wrongType('String', codec('Int')));
  });

  it('a number accepts Int, Float and BigInt(as: number), and refuses BigInt and String', async () => {
    const field: DBFieldAttribute = { type: 'number' };
    for (const accepted of ['Int', 'Float', 'BigInt(as: number)']) {
      expect(await problemsFor(target, field, accepted)).toEqual([]);
    }
    expect(await problemsFor(target, field, 'BigInt')).toEqual(wrongType('Int', codec('BigInt')));
    expect(await problemsFor(target, field, 'String')).toEqual(wrongType('Int', codec('String')));
  });

  it('a bigint number accepts BigInt(as: number) and refuses BigInt', async () => {
    const field: DBFieldAttribute = { type: 'number', bigint: true };
    expect(await problemsFor(target, field, 'BigInt(as: number)')).toEqual([]);
    expect(await problemsFor(target, field, 'BigInt')).toEqual(
      wrongType('BigInt(as: number)', codec('BigInt')),
    );
  });

  it('a boolean accepts Boolean and refuses Int', async () => {
    const field: DBFieldAttribute = { type: 'boolean' };
    expect(await problemsFor(target, field, 'Boolean')).toEqual([]);
    expect(await problemsFor(target, field, 'Int')).toEqual(wrongType('Boolean', codec('Int')));
  });

  it('a date accepts DateTime and refuses one read as Temporal or as a string', async () => {
    const field: DBFieldAttribute = { type: 'date' };
    expect(await problemsFor(target, field, 'DateTime')).toEqual([]);
    for (const refused of ['DateTime(as: temporal)', 'DateTime(as: string)']) {
      expect(await problemsFor(target, field, refused)).toEqual(
        wrongType('DateTime', codec(refused)),
      );
    }
  });

  it.each(['json', 'string[]', 'number[]'] as const)(
    'a %s field accepts String and refuses Json',
    async (type) => {
      const field: DBFieldAttribute = { type };
      expect(await problemsFor(target, field, 'String')).toEqual([]);
      expect(await problemsFor(target, field, 'Json')).toEqual(wrongType('String', codec('Json')));
    },
  );

  it('a value object is wrong for every Better Auth type', async () => {
    for (const type of ['string', 'json'] as const) {
      expect(await problemsFor(target, { type }, 'Address')).toEqual(
        wrongType('String', 'a value object'),
      );
    }
  });
});

describe('field types on postgres only', () => {
  it('a date accepts DateTime(storage: timestamp), as Prisma 7 created it', async () => {
    expect(await problemsFor('postgres', { type: 'date' }, 'DateTime(storage: timestamp)')).toEqual(
      [],
    );
  });

  it('a list of allowed strings accepts a native enum', async () => {
    expect(
      await problemsFor('postgres', { type: ['active', 'inactive'] }, 'pg.enum(NativeStatus)'),
    ).toEqual([]);
  });

  it('a list field is wrong', async () => {
    expect(await problemsFor('postgres', { type: 'string[]' }, 'String[]')).toEqual(
      wrongType('String', 'pg/text@1 list'),
    );
  });

  it('a string accepts a varchar column', async () => {
    expect(
      await problemsFor('postgres', { type: 'string' }, 'String(storage: varchar, length: 40)'),
    ).toEqual([]);
  });
});

describe.each(targets)('id types on %s', (target) => {
  async function idProblems(betterAuthOptions: BetterAuthOptions, idType: string) {
    const psl = pslForConfiguration(emptyContract(target), betterAuthOptions).replace(
      /(model User \{\n\s+id\s+)\S+/,
      `$1${idType}`,
    );
    const contract = (await emitContract(target, psl, workDir)).contract;
    return compare(contract, betterAuthOptions).problems;
  }

  it('Better Auth string ids accept String and refuse Int', async () => {
    expect(await idProblems({}, 'String')).toEqual([]);
    expect(await idProblems({}, 'Int')).toEqual([
      {
        kind: 'wrong-type',
        model: 'User',
        field: 'id',
        expectedType: 'id String @id',
        found: codecs[target]['Int'],
      },
    ]);
  });

  it('serial ids accept Int and refuse String, in the id and in a foreign key', async () => {
    const serial: BetterAuthOptions = { advanced: { database: { generateId: 'serial' } } };
    expect(await idProblems(serial, 'Int')).toEqual([]);
    const psl = pslForConfiguration(emptyContract(target), serial).replace(
      /(model Session \{[^}]*userId\s+)Int/,
      '$1String',
    );
    const contract = (await emitContract(target, psl, workDir)).contract;
    expect(compare(contract, serial).problems).toEqual([
      {
        kind: 'wrong-type',
        model: 'Session',
        field: 'userId',
        expectedType: 'Int',
        found: codecs[target]['String'],
      },
    ]);
  });
});

describe('id types on postgres only', () => {
  async function idProblems(betterAuthOptions: BetterAuthOptions, idType: string) {
    const psl = pslForConfiguration(emptyContract('postgres'), betterAuthOptions)
      .replace(/(model User \{\n\s+id\s+)\S+/, `$1${idType}`)
      .replace(/(model Session \{[^}]*userId\s+)String/, `$1${idType}`);
    const contract = (await emitContract('postgres', psl, workDir)).contract;
    return compare(contract, betterAuthOptions).problems;
  }

  it('uuid ids accept Uuid and String', async () => {
    const uuid: BetterAuthOptions = { advanced: { database: { generateId: 'uuid' } } };
    expect(await idProblems(uuid, 'Uuid')).toEqual([]);
    expect(await idProblems(uuid, 'String')).toEqual([]);
  });

  it('Better Auth string ids refuse Uuid', async () => {
    expect(await idProblems({}, 'Uuid')).toEqual([
      {
        kind: 'wrong-type',
        model: 'User',
        field: 'id',
        expectedType: 'id String @id',
        found: 'pg/uuid@1',
      },
      {
        kind: 'wrong-type',
        model: 'Session',
        field: 'userId',
        expectedType: 'String',
        found: 'pg/uuid@1',
      },
    ]);
  });
});
