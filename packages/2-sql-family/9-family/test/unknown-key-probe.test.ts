import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { probeUnknownKeys } from '../src/core/migrations/unknown-key-probe';

const Strict = type({
  '+': 'reject',
  name: 'string',
  steps: type({ '+': 'reject', sql: 'string', 'meta?': 'Record<string, unknown>' }).array(),
});

function readStrict(document: unknown): unknown {
  const result = Strict(document);
  if (result instanceof type.errors) throw new Error(result.summary);
  return result;
}

const document = {
  name: 'op',
  steps: [{ sql: 'SELECT 1', meta: { note: { by: 'someone' } } }, { sql: 'SELECT 2' }],
};

describe('probeUnknownKeys', () => {
  it('reports each place outside the open ones whose object accepts a key the format does not define', () => {
    expect(probeUnknownKeys(document, readStrict, [])).toEqual({
      objects: 5,
      accepted: ['steps[0].meta', 'steps[0].meta.note'],
    });
  });

  it('leaves out an open place, and with a trailing ** everything below it', () => {
    expect(
      probeUnknownKeys(document, readStrict, [
        ['steps', '*', 'meta'],
        ['steps', '*', 'meta', '*', '**'],
      ]),
    ).toEqual({ objects: 5, accepted: [] });
  });

  it('reports nothing for a reader that refuses an unknown key everywhere', () => {
    expect(probeUnknownKeys({ name: 'op', steps: [{ sql: 'x' }] }, readStrict, [])).toEqual({
      objects: 2,
      accepted: [],
    });
  });

  it('reports every object of a reader that accepts any key', () => {
    expect(probeUnknownKeys(document, (value) => value, []).accepted).toEqual([
      '',
      'steps[0]',
      'steps[0].meta',
      'steps[0].meta.note',
      'steps[1]',
    ]);
  });

  it('refuses a document its reader refuses without the added key', () => {
    expect(() => probeUnknownKeys({ name: 1, steps: [] }, readStrict, [])).toThrow(
      'The document is refused before any key is added: name must be a string (was a number)',
    );
  });

  it('refuses a document with no object to add a key to', () => {
    expect(() => probeUnknownKeys([], (value) => value, [])).toThrow(
      'The document has no object to add a key to',
    );
  });
});
