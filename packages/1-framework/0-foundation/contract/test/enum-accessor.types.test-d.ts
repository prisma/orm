import { expectTypeOf, test } from 'vitest';
import type { Contract } from '../src/contract-types';
import type { NamespacedEnums } from '../src/enum-accessor';
import type { ProfileHashBase, StorageBase, StorageHashBase } from '../src/types';

// An accessor for one enum with literal `values`/`names`/`members`, matching
// the runtime `EnumAccessor` shape the no-emit (built) contract carries on
// `enumAccessors`.
type Accessor<Values extends readonly unknown[], Names extends readonly string[], Members> = {
  readonly values: Values;
  readonly names: Names;
  readonly members: Members;
  has(v: Values[number]): boolean;
  nameOf(v: Values[number]): string | undefined;
  ordinalOf(v: Values[number]): number;
  readonly Value: Values[number];
};

// A literal contract shape mirroring the no-emit (built) carrier: enums are
// reached through the flat, already-accessor-shaped `enumAccessors` map
// (`BuiltEnumAccessorsOf`), which preserves literal tuples. Built as a
// standalone literal type — not via the SQL authoring builder, which the
// foundation layer must not depend on. The `toExtend<Contract>` assertion below
// proves it still satisfies the framework contract interface.
type EnumContract = {
  readonly target: 'postgres';
  readonly targetFamily: 'sql';
  readonly roots: Record<string, never>;
  readonly storage: StorageBase<'abc'>;
  readonly capabilities: Record<string, Record<string, boolean>>;
  readonly extensions: Record<string, never>;
  readonly profileHash: ProfileHashBase<'def'>;
  readonly meta: Record<string, never>;
  readonly enumAccessors: {
    readonly Role: Accessor<
      readonly ['user', 'admin'],
      readonly ['User', 'Admin'],
      { readonly User: 'user'; readonly Admin: 'admin' }
    >;
    readonly Status: Accessor<
      readonly ['active', 'inactive'],
      readonly ['Active', 'Inactive'],
      { readonly Active: 'active'; readonly Inactive: 'inactive' }
    >;
  };
  readonly domain: {
    readonly namespaces: {
      readonly public: {
        readonly models: Record<string, never>;
      };
    };
  };
};

test('EnumContract conforms to the Contract interface', () => {
  expectTypeOf<EnumContract>().toExtend<Contract>();
  expectTypeOf<EnumContract['storage']['storageHash']>().toEqualTypeOf<StorageHashBase<'abc'>>();
});

// `NamespacedEnums` accepts any `Contract`; the literal contract above narrows
// the namespaces so the accessor surface keeps its literal tuples.
type Enums = NamespacedEnums<EnumContract>;
const publicEnums = {} as Enums['public'];

// ---------------------------------------------------------------------------
// enums.<ns>.<Name>.values is the ordered literal tuple, not string[]
// ---------------------------------------------------------------------------

test('enums.public.Role.values is the literal value tuple', () => {
  expectTypeOf(publicEnums.Role.values).toEqualTypeOf<readonly ['user', 'admin']>();
});

test('enums.public.Role.values is not a widened string[]', () => {
  expectTypeOf(publicEnums.Role.values).not.toEqualTypeOf<readonly string[]>();
});

test('enums.public.Status.values preserves declaration order as a literal tuple', () => {
  expectTypeOf(publicEnums.Status.values).toEqualTypeOf<readonly ['active', 'inactive']>();
});

// ---------------------------------------------------------------------------
// enums.<ns>.<Name>.members.<Name> resolves to the member value literal
// ---------------------------------------------------------------------------

test('enums.public.Role.members.User is the value literal', () => {
  expectTypeOf(publicEnums.Role.members.User).toEqualTypeOf<'user'>();
});

test('enums.public.Role.members.Admin is the value literal', () => {
  expectTypeOf(publicEnums.Role.members.Admin).toEqualTypeOf<'admin'>();
});

// ---------------------------------------------------------------------------
// enums.<ns>.<Name>.names is the literal name tuple
// ---------------------------------------------------------------------------

test('enums.public.Role.names is the literal name tuple', () => {
  expectTypeOf(publicEnums.Role.names).toEqualTypeOf<readonly ['User', 'Admin']>();
});

// ---------------------------------------------------------------------------
// enums.<ns>.<Name>.Value is the phantom value-union type (type-only, no
// runtime property) — `typeof accessor.Value` gives the literal union.
// ---------------------------------------------------------------------------

test('enums.public.Role.Value is the literal value union', () => {
  expectTypeOf(publicEnums.Role.Value).toEqualTypeOf<'user' | 'admin'>();
});

test('enums.public.Status.Value is the literal value union', () => {
  expectTypeOf(publicEnums.Status.Value).toEqualTypeOf<'active' | 'inactive'>();
});

// ---------------------------------------------------------------------------
// An emitted contract: a namespace's `enum` types each member as
// `contract.json` stores it, and `enumMemberTypes` types it as the application
// reads it.
// ---------------------------------------------------------------------------

type EmittedContract = Omit<EnumContract, 'enumAccessors' | 'domain'> & {
  readonly domain: {
    readonly namespaces: {
      readonly public: {
        readonly models: Record<string, never>;
        readonly enum: {
          readonly Level: {
            readonly codecId: 'pg/int8@1';
            readonly members: readonly [
              { readonly name: 'Low'; readonly value: '1' },
              { readonly name: 'High'; readonly value: '10' },
            ];
          };
        };
        readonly enumMemberTypes?: {
          readonly Level: readonly [
            { readonly name: 'Low'; readonly value: 1n },
            { readonly name: 'High'; readonly value: 10n },
          ];
        };
      };
      readonly audit: {
        readonly models: Record<string, never>;
        readonly enum: {
          readonly Kind: {
            readonly codecId: 'pg/text@1';
            readonly members: readonly [{ readonly name: 'Login'; readonly value: 'login' }];
          };
        };
      };
    };
  };
};

type EmittedEnums = NamespacedEnums<EmittedContract>;
const emittedLevel = {} as EmittedEnums['public']['Level'];

test('an emitted contract types members as the application reads them', () => {
  expectTypeOf(emittedLevel.members.Low).toEqualTypeOf<1n>();
  expectTypeOf(emittedLevel.values).toEqualTypeOf<readonly [1n, 10n]>();
  expectTypeOf(emittedLevel.names).toEqualTypeOf<readonly ['Low', 'High']>();
  expectTypeOf(emittedLevel.Value).toEqualTypeOf<1n | 10n>();
});

test('has() narrows a value read from the database to the member union', () => {
  const read: bigint = 1n;
  if (emittedLevel.has(read)) {
    expectTypeOf(read).toEqualTypeOf<1n | 10n>();
  }
});

test('a namespace without emitted member types falls back to the stored forms', () => {
  expectTypeOf<EmittedEnums['audit']['Kind']['members']['Login']>().toEqualTypeOf<'login'>();
});
