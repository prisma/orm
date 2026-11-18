import type { ComponentMetadata } from '@internal/framework-components/components';
import type { TypesImportSpec } from '@internal/framework-components/emission';
import { describe, expectTypeOf, it } from 'vitest';

type ComponentTypes = NonNullable<ComponentMetadata['types']>;

type NamesTypes<T> = [T] extends [TypesImportSpec]
  ? true
  : [T] extends [ReadonlyArray<infer Element>]
    ? [Element] extends [TypesImportSpec]
      ? true
      : false
    : false;

type TypeImportKeys<T> = {
  [K in keyof T & string]-?: NamesTypes<NonNullable<T[K]>> extends true ? K : never;
}[keyof T & string];

type TypeImportMembers =
  | TypeImportKeys<ComponentTypes>
  | {
      [K in keyof ComponentTypes & string]-?: NonNullable<
        ComponentTypes[K]
      > extends ReadonlyArray<unknown>
        ? never
        : `${K}.${TypeImportKeys<NonNullable<ComponentTypes[K]>>}`;
    }[keyof ComponentTypes & string];

describe('the type declarations restateTypeDeclarations rewrites', () => {
  it('are every member of a component’s types that names a type import', () => {
    expectTypeOf<TypeImportMembers>().toEqualTypeOf<
      | 'codecTypes.import'
      | 'codecTypes.typeImports'
      | 'codecTypes.parameterizedOutputTypes'
      | 'queryOperationTypes.import'
    >();
  });
});
