import type {
  ExtensionPackRef,
  FamilyPackRef,
  TargetPackRef,
} from '@internal/framework-components/components';
import { expectTypeOf, test } from 'vitest';
import type { SqlContractResult } from '../src/contract-types';

declare const family: FamilyPackRef<'sql'>;
declare const target: Omit<TargetPackRef<'sql', 'postgres'>, 'capabilities'> & {
  readonly defaultNamespaceId: 'public';
  readonly capabilities: {
    readonly sql: { readonly fromTarget: true; readonly turnedOff: true; readonly turnedOn: false };
  };
};
declare const adapter: {
  readonly capabilities: {
    readonly sql: {
      readonly turnedOff: false;
      readonly turnedOn: true;
      readonly fromAdapter: true;
    };
  };
};
declare const first: Omit<ExtensionPackRef<'sql', 'postgres'>, 'capabilities'> & {
  readonly capabilities: { readonly ext: { readonly agreed: true; readonly disputed: true } };
};
declare const second: Omit<ExtensionPackRef<'sql', 'postgres'>, 'capabilities'> & {
  readonly capabilities: {
    readonly ext: { readonly agreed: true; readonly disputed: false };
    readonly sql: { readonly fromAdapter: false };
  };
};

type Capabilities = SqlContractResult<{
  readonly family: typeof family;
  readonly target: typeof target;
  readonly adapter: typeof adapter;
  readonly extensions: { readonly first: typeof first; readonly second: typeof second };
}>['capabilities'];

test('the adapter replaces the flags of the target it sets, and the extensions replace both', () => {
  expectTypeOf<Capabilities['sql']>().toEqualTypeOf<{
    readonly fromTarget: true;
    readonly turnedOn: true;
  }>();
});

test('a flag two extensions set differently is not claimed, since the runtime keeps the one listed last', () => {
  expectTypeOf<Capabilities['ext']>().toEqualTypeOf<{ readonly agreed: true }>();
});
