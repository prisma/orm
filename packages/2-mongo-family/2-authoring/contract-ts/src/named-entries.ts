import { contractError } from './contract-errors';

/** An author's object of named entries: what its entries are, and the model or value object that holds them. */
export type NamedEntriesSite =
  | { readonly kind: 'model' | 'valueObject' | 'enum' | 'root' | 'extensionPack' }
  | {
      readonly kind: 'field' | 'relation' | 'storageRelation' | 'variant';
      readonly modelName: string;
    }
  | { readonly kind: 'valueObjectField'; readonly valueObjectName: string };

/** How an error message names an author's object of named entries, such as `The fields of model "User"`. */
function namedEntriesSubject(site: NamedEntriesSite): string {
  switch (site.kind) {
    case 'model':
      return 'The models of the contract';
    case 'valueObject':
      return 'The value objects of the contract';
    case 'enum':
      return 'The enums of the contract';
    case 'root':
      return 'The roots of the contract';
    case 'extensionPack':
      return 'The extensions of the contract';
    case 'field':
      return `The fields of model "${site.modelName}"`;
    case 'relation':
      return `The relations of model "${site.modelName}"`;
    case 'storageRelation':
      return `The storage relations of model "${site.modelName}"`;
    case 'variant':
      return `The variants of model "${site.modelName}"`;
    case 'valueObjectField':
      return `The fields of value object "${site.valueObjectName}"`;
  }
}

/**
 * Refuses an author's object of named entries that is not a plain object: its prototype is neither the plain object one nor `null`. A key written as `__proto__` in an object literal replaces the prototype and stores no entry, so the builder would never see that name.
 */
export function assertPlainNamedEntries(entries: object, site: NamedEntriesSite): void {
  const prototype = Object.getPrototypeOf(entries);
  if (prototype === Object.prototype || prototype === null) return;
  throw contractError(
    'CONTRACT.NAME_UNUSABLE_AS_KEY',
    `${namedEntriesSubject(site)} are not a plain object: their prototype has been replaced. A key written as "__proto__" in an object literal does this. Use a plain object, and choose another name for a "__proto__" key.`,
    { meta: { ...site, reason: 'prototype-replaced' } },
  );
}
