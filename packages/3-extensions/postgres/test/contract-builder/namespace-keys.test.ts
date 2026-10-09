import { describe, expect, expectTypeOf, it } from 'vitest';
import { defineContract } from '../../src/exports/contract-builder';
import postgres from '../../src/exports/runtime';

const url = 'postgres://localhost/db';

function domainModels(namespaces: Record<string, { readonly models: object }>) {
  return Object.fromEntries(
    Object.entries(namespaces).map(([id, namespace]) => [id, Object.keys(namespace.models)]),
  );
}

describe('the namespaces of a TypeScript contract', () => {
  it('holds every model in its declared namespace and no default namespace', () => {
    const contract = defineContract({ namespaces: ['auth'] }, ({ field, model }) => ({
      models: {
        Session: model('Session', {
          namespace: 'auth',
          fields: { id: field.id.uuidv4String() },
        }).sql({ table: 'sessions' }),
      },
    }));
    const client = postgres({ contract, url });

    expectTypeOf<keyof typeof contract.domain.namespaces>().toEqualTypeOf<'auth'>();
    expectTypeOf<
      keyof (typeof contract.domain.namespaces)['auth']['models']
    >().toEqualTypeOf<'Session'>();
    expectTypeOf<keyof typeof contract.storage.namespaces>().toEqualTypeOf<'public' | 'auth'>();
    expectTypeOf<keyof typeof client.orm>().toEqualTypeOf<'auth' | 'fragment'>();
    expect({
      domain: domainModels(contract.domain.namespaces),
      storage: Object.keys(contract.storage.namespaces),
      ormNamespaces: [Reflect.get(client.orm, 'public'), client.orm.auth.Session].map(
        (value) => value !== undefined,
      ),
    }).toEqual({
      domain: { auth: ['Session'] },
      storage: ['auth', 'public'],
      ormNamespaces: [false, true],
    });
  });

  it('has no domain namespace for a declared namespace without models', () => {
    const contract = defineContract({ namespaces: ['audit'] }, ({ field, model }) => ({
      models: {
        User: model('User', { fields: { id: field.id.uuidv4String() } }).sql({ table: 'users' }),
      },
    }));

    expectTypeOf<keyof typeof contract.domain.namespaces>().toEqualTypeOf<'public'>();
    expectTypeOf<keyof typeof contract.storage.namespaces>().toEqualTypeOf<'public' | 'audit'>();
    expectTypeOf<
      keyof (typeof contract.storage.namespaces)['audit']['entries']['table']
    >().toEqualTypeOf<never>();
    expect({
      domain: domainModels(contract.domain.namespaces),
      storage: Object.keys(contract.storage.namespaces),
      auditTables: Object.keys(contract.storage.namespaces.audit.entries.table ?? {}),
    }).toEqual({ domain: { public: ['User'] }, storage: ['audit', 'public'], auditTables: [] });
  });

  it('places each model in its own namespace', () => {
    const contract = defineContract({ namespaces: ['auth'] }, ({ field, model }) => ({
      models: {
        User: model('User', { fields: { id: field.id.uuidv4String() } }).sql({ table: 'users' }),
        Session: model('Session', {
          namespace: 'auth',
          fields: { id: field.id.uuidv4String() },
        }).sql({ table: 'sessions' }),
      },
    }));
    type Namespaces = typeof contract.domain.namespaces;
    type Tables<Ns extends keyof typeof contract.storage.namespaces> =
      keyof (typeof contract.storage.namespaces)[Ns]['entries']['table'];

    expectTypeOf<keyof Namespaces['public']['models']>().toEqualTypeOf<'User'>();
    expectTypeOf<keyof Namespaces['auth']['models']>().toEqualTypeOf<'Session'>();
    expectTypeOf<Tables<'public'>>().toEqualTypeOf<'users'>();
    expectTypeOf<Tables<'auth'>>().toEqualTypeOf<'sessions'>();
    expect({
      domain: domainModels(contract.domain.namespaces),
      publicTables: Object.keys(contract.storage.namespaces.public.entries.table ?? {}),
      authTables: Object.keys(contract.storage.namespaces.auth.entries.table ?? {}),
    }).toEqual({
      domain: { auth: ['Session'], public: ['User'] },
      publicTables: ['users'],
      authTables: ['sessions'],
    });
  });

  it('types the rows of a model in a declared namespace with the codec output types', async () => {
    const contract = defineContract({ namespaces: ['auth'] }, ({ field, model, type }) => ({
      models: {
        Session: model('Session', {
          namespace: 'auth',
          fields: {
            id: field.id.uuidv4String(),
            label: field.column(type.sql.String(50)),
            expiresAt: field.temporal.timestamptzJsDate().optional(),
          },
        }).sql({ table: 'sessions' }),
      },
    }));
    const client = postgres({ contract, url });
    const first = () => client.orm.auth.Session.first();

    expectTypeOf<Awaited<ReturnType<typeof first>>>().toEqualTypeOf<{
      id: string;
      label: string;
      expiresAt: Date | null;
    } | null>();
    expect(client.orm.auth.Session).toBeDefined();
  });

  it('lists every model in every namespace when a model namespace is not a literal', () => {
    const sessionNamespace: string = 'auth';
    const contract = defineContract({ namespaces: ['auth', 'billing'] }, ({ field, model }) => ({
      models: {
        User: model('User', { fields: { id: field.id.uuidv4String() } }).sql({ table: 'users' }),
        Invoice: model('Invoice', {
          namespace: 'billing',
          fields: { id: field.id.uuidv4String() },
        }).sql({ table: 'invoices' }),
        Session: model('Session', {
          namespace: sessionNamespace,
          fields: { id: field.id.uuidv4String() },
        }).sql({ table: 'sessions' }),
      },
    }));
    const client = postgres({ contract, url });
    type Models = keyof NonNullable<(typeof contract.domain.namespaces)[string]>['models'];
    type OrmModels = keyof NonNullable<(typeof client.orm)[string]>;

    expectTypeOf<keyof typeof contract.domain.namespaces>().toEqualTypeOf<string>();
    expectTypeOf<Models>().toEqualTypeOf<'User' | 'Invoice' | 'Session'>();
    expectTypeOf<OrmModels>().toEqualTypeOf<'User' | 'Invoice' | 'Session'>();
    expect({
      domain: domainModels(contract.domain.namespaces),
      reachable: [
        client.orm['public']?.User,
        client.orm['billing']?.Invoice,
        client.orm['auth']?.Session,
      ].map((collection) => collection !== undefined),
    }).toEqual({
      domain: { auth: ['Session'], billing: ['Invoice'], public: ['User'] },
      reachable: [true, true, true],
    });
  });
});
