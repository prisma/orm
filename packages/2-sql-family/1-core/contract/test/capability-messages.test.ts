import { describe, expect, it } from 'vitest';
import {
  capabilityKeysText,
  capabilityUnavailableMessage,
} from '../src/exports/capability-messages';

describe('capabilityKeysText', () => {
  it.each([
    [['sql.returning'], '`sql.returning`'],
    [['sql.returning', 'sql.lateral'], '`sql.returning` and `sql.lateral`'],
    [
      ['sql.returning', 'sql.lateral', 'postgres.distinctOn'],
      '`sql.returning`, `sql.lateral` and `postgres.distinctOn`',
    ],
  ])('lists %j as %s', (keys, text) => {
    expect(capabilityKeysText(keys)).toBe(text);
  });
});

describe('capabilityUnavailableMessage', () => {
  it('names the feature and the key, and says how to enable it', () => {
    expect(capabilityUnavailableMessage('`upsert()`', ['sql.insertOnConflictTarget'])).toBe(
      "`upsert()` is unavailable: your contract declares no dependency on `sql.insertOnConflictTarget`. To enable it, add `sql.insertOnConflictTarget` to your contract's required capabilities.",
    );
  });

  it('puts the reason between the two sentences', () => {
    expect(
      capabilityUnavailableMessage('`create()`', ['sql.returning'], 'It reads back by key.'),
    ).toBe(
      "`create()` is unavailable: your contract declares no dependency on `sql.returning`. It reads back by key. To enable it, add `sql.returning` to your contract's required capabilities.",
    );
  });

  it('lists several keys', () => {
    expect(capabilityUnavailableMessage('`find()`', ['sql.jsonAgg', 'sql.lateral'])).toBe(
      "`find()` is unavailable: your contract declares no dependency on `sql.jsonAgg` and `sql.lateral`. To enable it, add `sql.jsonAgg` and `sql.lateral` to your contract's required capabilities.",
    );
  });
});
