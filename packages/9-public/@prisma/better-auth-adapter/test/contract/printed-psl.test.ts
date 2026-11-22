import type { BetterAuthOptions, BetterAuthPlugin } from '@better-auth/core';
import { twoFactor } from 'better-auth/plugins';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { printPsl } from '../../src/contract/print-psl';
import {
  applyContract,
  createWorkDir,
  type EmittedContract,
  emitContract,
  resetPostgres,
  type SqlContract,
  type TargetName,
  targets,
  type WorkDir,
} from '../helpers/databases';
import { everyFirstPartyPlugin } from '../helpers/plugins';
import { type PostgresServer, startPostgresServer } from '../helpers/postgres-server';
import {
  type AdapterOptionsForComparison,
  addPrintedPsl,
  compare,
  pslForConfiguration,
  pslHeader,
} from '../helpers/printed-psl';
import { timeouts } from '../timeouts';

let workDir: WorkDir;
let server: PostgresServer;
const emptyContracts = new Map<TargetName, SqlContract>();

beforeAll(async () => {
  workDir = await createWorkDir();
  server = await startPostgresServer();
  for (const target of targets) {
    emptyContracts.set(target, (await emitContract(target, pslHeader, workDir)).contract);
  }
}, timeouts.devServerStart);

afterAll(async () => {
  await server?.close();
  await workDir?.remove();
}, timeouts.devServerClose + timeouts.hook);

function emptyContract(target: TargetName): SqlContract {
  const contract = emptyContracts.get(target);
  if (contract === undefined) throw new Error(`No empty ${target} contract`);
  return contract;
}

/**
 * Emits the PSL, creates its tables in an empty database, and checks that the comparison over the emitted contract finds nothing missing.
 */
async function emitAndApply(
  target: TargetName,
  psl: string,
  betterAuthOptions: BetterAuthOptions,
  adapterOptions: AdapterOptionsForComparison = {},
): Promise<EmittedContract> {
  const emitted = await emitContract(target, psl, workDir);
  if (target === 'sqlite') {
    await applyContract(target, emitted.json, `${workDir.nextPath('database')}.sqlite`, workDir);
  } else {
    await resetPostgres(server.url);
    await applyContract(target, emitted.json, server.url, workDir);
  }
  expect(compare(emitted.contract, betterAuthOptions, adapterOptions).problems).toEqual([]);
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
    const baseContract = (await emitContract(target, base, workDir)).contract;
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
    const baseContract = (await emitContract('postgres', base, workDir)).contract;
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
