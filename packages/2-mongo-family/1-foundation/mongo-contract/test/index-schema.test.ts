import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { StorageCollectionSchema } from '../src/contract-schema';

const keys = [{ field: 'email', direction: 1 }];

describe('a collection index in contract JSON', () => {
  it('needs a name', () => {
    expect({
      named:
        StorageCollectionSchema({ indexes: [{ name: 'email_1', keys }] }) instanceof type.errors,
      unnamed: StorageCollectionSchema({ indexes: [{ keys }] }) instanceof type.errors,
      empty: StorageCollectionSchema({ indexes: [{ name: '', keys }] }) instanceof type.errors,
    }).toEqual({ named: false, unnamed: true, empty: true });
  });
});
