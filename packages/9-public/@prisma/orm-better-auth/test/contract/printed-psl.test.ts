import type { BetterAuthOptions, BetterAuthPlugin } from '@better-auth/core';
import { twoFactor } from 'better-auth/plugins';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { printPsl } from '../../src/contract/print-psl';
import { useContractFixture } from '../helpers/contract-fixture';
import {
  applyContract,
  type EmittedContract,
  emitContract,
  resetPostgres,
  type TargetName,
  targets,
} from '../helpers/databases';
import { everyFirstPartyPlugin } from '../helpers/plugins';
import { type PostgresServer, startPostgresServer } from '../helpers/postgres-server';
import {
  type AdapterOptionsForComparison,
  addPrintedPsl,
  compare,
  problemsOf,
  pslForConfiguration,
} from '../helpers/printed-psl';
import { timeouts } from '../timeouts';

const fixture = useContractFixture();
const emptyContract = (target: TargetName) => fixture().emptyContract(target);
let server: PostgresServer;

beforeAll(async () => {
  server = await startPostgresServer();
}, timeouts.devServerStart);

afterAll(() => server?.close(), timeouts.devServerClose + timeouts.hook);

/**
 * Emits the PSL, creates its tables in an empty database, and checks that the comparison over the emitted contract finds nothing missing.
 */
async function emitAndApply(
  target: TargetName,
  psl: string,
  betterAuthOptions: BetterAuthOptions,
  adapterOptions: AdapterOptionsForComparison = {},
): Promise<EmittedContract> {
  const emitted = await emitContract(target, psl, fixture().workDir);
  if (target === 'sqlite') {
    await applyContract(
      target,
      emitted.json,
      `${fixture().workDir.nextPath('database')}.sqlite`,
      fixture().workDir,
    );
  } else {
    await resetPostgres(server.url);
    await applyContract(target, emitted.json, server.url, fixture().workDir);
  }
  expect(problemsOf(compare(emitted.contract, betterAuthOptions, adapterOptions))).toEqual([]);
  return emitted;
}

function fieldLine(name: string, type: string, attributes?: string): RegExp {
  const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = [name, type, attributes]
    .filter((part) => part !== undefined)
    .map(escaped)
    .join(' +');
  return new RegExp(`^  ${pattern}$`, 'm');
}

function plugin(schema: NonNullable<BetterAuthPlugin['schema']>): BetterAuthPlugin {
  return { id: 'test-schema', schema };
}

const twoForeignKeysToOneModel: BetterAuthOptions = {
  plugins: [
    plugin({
      invitation: {
        fields: {
          inviterId: { type: 'string', references: { model: 'user', field: 'id' } },
          inviteeId: {
            type: 'string',
            required: false,
            references: { model: 'user', field: 'id', onDelete: 'set null' },
          },
        },
      },
    }),
  ],
};

const selfReference: BetterAuthOptions = {
  plugins: [
    plugin({
      folder: {
        fields: {
          name: { type: 'string' },
          parentId: {
            type: 'string',
            required: false,
            references: { model: 'folder', field: 'id' },
          },
        },
      },
    }),
  ],
};

const foreignKeyNamedUser: BetterAuthOptions = {
  plugins: [
    plugin({
      note: {
        fields: {
          user: { type: 'string', references: { model: 'user', field: 'id' } },
          body: { type: 'string' },
        },
      },
    }),
  ],
};

const relationNameTaken: BetterAuthOptions = {
  plugins: [
    plugin({
      note: {
        fields: {
          user: { type: 'string', references: { model: 'user', field: 'id' } },
          userRelation: { type: 'string', required: false },
        },
      },
    }),
  ],
};

const backRelationNameTaken: BetterAuthOptions = {
  ...twoForeignKeysToOneModel,
  user: { additionalFields: { invitationsByInviterId: { type: 'string', required: false } } },
};

const renamedModelsAndFields: BetterAuthOptions = {
  user: { modelName: 'member', fields: { email: 'emailAddress', name: 'displayName' } },
  session: { modelName: 'login', fields: { userId: 'memberId', token: 'sessionToken' } },
  account: { fields: { userId: 'ownerId' } },
};

const cases: readonly {
  readonly name: string;
  readonly options: BetterAuthOptions;
  readonly adapterOptions?: AdapterOptionsForComparison;
}[] = [
  { name: 'the default configuration', options: {} },
  { name: 'every first-party plugin schema at once', options: everyFirstPartyPlugin },
  { name: 'a table with two foreign keys to one model', options: twoForeignKeysToOneModel },
  { name: 'a self-reference', options: selfReference },
  { name: 'a foreign key named user', options: foreignKeyNamedUser },
  { name: 'a taken relation field name', options: relationNameTaken },
  { name: 'a taken back-relation field name', options: backRelationNameTaken },
  {
    name: 'serial ids',
    options: { ...everyFirstPartyPlugin, advanced: { database: { generateId: 'serial' } } },
  },
  {
    name: 'ids the database generates',
    options: { ...everyFirstPartyPlugin, advanced: { database: { generateId: false } } },
  },
  { name: 'renamed models and fields', options: renamedModelsAndFields },
  {
    name: 'plural model names',
    options: everyFirstPartyPlugin,
    adapterOptions: { usePlural: true },
  },
];

describe.each(targets)('printed PSL on %s', (target) => {
  it.each(cases)('emits and applies for $name', async ({ options, adapterOptions }) => {
    const psl = pslForConfiguration(emptyContract(target), options, adapterOptions);
    await emitAndApply(target, psl, options, adapterOptions);
  });

  it('adds missing fields and a back-relation to an existing model', async () => {
    const base = pslForConfiguration(emptyContract(target), {});
    const baseContract = await fixture().contractOf(target, base);
    const options: BetterAuthOptions = { plugins: [twoFactor()] };
    const printed = printPsl(compare(baseContract, options));

    expect(printed.blocks.find((block) => block.modelName === 'User')).toEqual({
      modelName: 'User',
      existing: true,
      fieldLines: ['twoFactorEnabled Boolean?', 'twoFactors       TwoFactor[]'],
      attributeLines: [],
    });
    await emitAndApply(target, addPrintedPsl(base, printed), options);
  });
});

describe.each(targets)('printed PSL referencing an application model on %s', (target) => {
  it("relates to a model the contract has outside Better Auth's tables", async () => {
    const base = `${pslForConfiguration(emptyContract(target), {})}
model Project {
  id String @id

  @@map("project")
}
`;
    const baseContract = await fixture().contractOf(target, base);
    const options: BetterAuthOptions = {
      plugins: [
        plugin({
          note: {
            fields: {
              projectId: { type: 'string', references: { model: 'project', field: 'id' } },
            },
          },
        }),
      ],
    };
    const printed = printPsl(compare(baseContract, options));
    expect(printed.blocks.find((block) => block.modelName === 'Project')).toEqual({
      modelName: 'Project',
      existing: true,
      fieldLines: ['notes Note[]'],
      attributeLines: [],
    });
    await emitAndApply(target, addPrintedPsl(base, printed), options);
  });
});

describe('printed PSL referencing an existing id of each type the comparison accepts on postgres', () => {
  const idTypes: readonly { readonly type: string; readonly options: BetterAuthOptions }[] = [
    { type: 'Uuid', options: { advanced: { database: { generateId: 'uuid' } } } },
    { type: 'Varchar(36)', options: {} },
    { type: 'Char(36)', options: {} },
    { type: 'Int2', options: { advanced: { database: { generateId: 'serial' } } } },
    { type: 'Int8Number', options: { advanced: { database: { generateId: 'serial' } } } },
  ];

  it.each(idTypes)('a new model references a $type id', async ({ type, options }) => {
    const keyType = type.startsWith('Int') ? 'Int' : 'String';
    const base = pslForConfiguration(emptyContract('postgres'), options)
      .replace(/(model User \{\n\s+id\s+)\w+/, `$1${type}`)
      .replace(new RegExp(`userId(\\s+)${keyType}\\b`, 'g'), `userId$1${type}`);
    const baseContract = await fixture().contractOf('postgres', base);
    const withTwoFactor: BetterAuthOptions = { ...options, plugins: [twoFactor()] };
    const printed = printPsl(compare(baseContract, withTwoFactor));
    await emitAndApply('postgres', addPrintedPsl(base, printed), withTwoFactor);
  });
});

describe('printed PSL for model names that differ only in the case of the first letter', () => {
  const upperUser: BetterAuthOptions = {
    plugins: [plugin({ upperUser: { modelName: 'User', fields: { note: { type: 'string' } } } })],
  };

  it('prints each under a distinct model name', () => {
    const { text } = printPsl(compare(emptyContract('postgres'), upperUser));
    expect(text).toContain('model user {');
    expect(text).toContain('@@map("user")');
    expect(text).toContain('model User {');
    expect(text).toContain('@@map("User")');
  });

  it('emits and applies on postgres', async () => {
    await emitAndApply(
      'postgres',
      pslForConfiguration(emptyContract('postgres'), upperUser),
      upperUser,
    );
  });
});

describe('printed PSL on postgres namespaces', () => {
  it('puts missing models in the namespace the option names', async () => {
    const adapterOptions = { namespace: 'auth' };
    const psl = pslForConfiguration(
      emptyContract('postgres'),
      everyFirstPartyPlugin,
      adapterOptions,
    );
    expect(psl).toContain('namespace auth {\n  model User {');
    const emitted = await emitAndApply('postgres', psl, everyFirstPartyPlugin, adapterOptions);
    expect(Object.keys(emitted.contract.domain.namespaces)).toContain('auth');
  });

  it('names models across namespaces when existing auth models are outside public', async () => {
    const base = pslForConfiguration(emptyContract('postgres'), {}, { namespace: 'auth' });
    const baseContract = await fixture().contractOf('postgres', base);
    const options: BetterAuthOptions = { plugins: [twoFactor()] };
    const printed = printPsl(compare(baseContract, options));

    expect(printed.text).toMatch(fieldLine('twoFactors', 'public.TwoFactor[]'));
    expect(printed.text).toMatch(
      fieldLine(
        'user',
        'auth.User',
        '@relation(fields: [userId], references: [id], onDelete: Cascade)',
      ),
    );
    await emitAndApply('postgres', addPrintedPsl(base, printed), options);
  });
});

describe('printed relation names', () => {
  const sqlite = () => emptyContract('sqlite');

  it('names both sides when a table has two foreign keys to one model', () => {
    const { text } = printPsl(compare(sqlite(), twoForeignKeysToOneModel));
    expect(text).toMatch(
      fieldLine('invitationsByInviterId', 'Invitation[]', '@relation("Invitation_inviterId")'),
    );
    expect(text).toMatch(
      fieldLine(
        'inviter',
        'User',
        '@relation("Invitation_inviterId", fields: [inviterId], references: [id], onDelete: Cascade)',
      ),
    );
    expect(text).toMatch(
      fieldLine(
        'invitee',
        'User?',
        '@relation("Invitation_inviteeId", fields: [inviteeId], references: [id], onDelete: SetNull)',
      ),
    );
  });

  it('a self-reference holds both sides in one model', () => {
    const { text } = printPsl(compare(sqlite(), selfReference));
    expect(text).toMatch(
      fieldLine(
        'parent',
        'Folder?',
        '@relation(fields: [parentId], references: [id], onDelete: Cascade)',
      ),
    );
    expect(text).toMatch(fieldLine('folders', 'Folder[]'));
  });

  it('a foreign key named user gets a relation field named userRelation', () => {
    const { text } = printPsl(compare(sqlite(), foreignKeyNamedUser));
    expect(text).toMatch(
      fieldLine(
        'userRelation',
        'User',
        '@relation(fields: [user], references: [id], onDelete: Cascade)',
      ),
    );
  });

  it('appends _ to a relation field name that is taken', () => {
    const { text } = printPsl(compare(sqlite(), relationNameTaken));
    expect(text).toMatch(
      fieldLine(
        'userRelation_',
        'User',
        '@relation(fields: [user], references: [id], onDelete: Cascade)',
      ),
    );
  });

  it('appends _ to a back-relation field name that is taken', () => {
    const { text } = printPsl(compare(sqlite(), backRelationNameTaken));
    expect(text).toMatch(fieldLine('invitationsByInviterId', 'String?'));
    expect(text).toMatch(
      fieldLine('invitationsByInviterId_', 'Invitation[]', '@relation("Invitation_inviterId")'),
    );
  });

  it('a renamed foreign key names the relation and references the renamed model', () => {
    const { text } = printPsl(compare(sqlite(), renamedModelsAndFields));
    expect(text).toContain('model Member {');
    expect(text).toContain('@@map("member")');
    expect(text).toMatch(
      fieldLine(
        'member',
        'Member',
        '@relation(fields: [memberId], references: [id], onDelete: Cascade)',
      ),
    );
    expect(text).toMatch(fieldLine('logins', 'Login[]'));
  });

  it('serial ids print an autoincrement id and Int foreign keys', () => {
    const { text } = printPsl(
      compare(sqlite(), { advanced: { database: { generateId: 'serial' } } }),
    );
    expect(text).toMatch(fieldLine('id', 'Int', '@id @default(autoincrement())'));
    expect(text).toMatch(fieldLine('userId', 'Int'));
  });

  it('ids the database generates print a uuid generator', () => {
    const { text } = printPsl(compare(sqlite(), { advanced: { database: { generateId: false } } }));
    expect(text).toMatch(fieldLine('id', 'String', '@id @onCreate(uuid())'));
  });
});
