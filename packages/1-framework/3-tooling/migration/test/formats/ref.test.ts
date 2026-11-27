import { describe, expect, it } from 'vitest';
import { refV1FromV0 } from '../../src/formats/ref/v1';
import { parseRefDocument, printRefDocument } from '../../src/formats/ref/versions';

const content = {
  hash: 'c'.repeat(64),
  invariants: ['backfill-users'],
  policies: { dataLoss: 'refuse' },
};

function caught(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

describe('ref file format version 1', () => {
  it('prints the format version first', () => {
    const document = printRefDocument(content);
    expect(Object.keys(document)[0]).toBe('formatVersion');
    expect(document).toEqual({ formatVersion: 1, ...content });
  });

  it('prints no policies for a ref without them', () => {
    expect(printRefDocument({ hash: content.hash, invariants: [] })).toEqual({
      formatVersion: 1,
      hash: content.hash,
      invariants: [],
    });
  });

  it('parses what it prints into the same ref', () => {
    const printed = JSON.parse(JSON.stringify(printRefDocument(content)));
    expect(parseRefDocument(printed, '/r/prod.json').assertOk()).toEqual(content);
  });

  it('refuses a file written by a newer release', () => {
    expect(
      caught(() => parseRefDocument({ ...content, formatVersion: 2 }, '/r/prod.json')),
    ).toMatchObject({ code: 'MIGRATION.FORMAT_VERSION_NEWER', where: { path: '/r/prod.json' } });
  });

  it('refuses a file with the old schemaVersion field', () => {
    expect(
      caught(() => parseRefDocument({ schemaVersion: '1', ...content }, '/r/prod.json')),
    ).toMatchObject({ code: 'MIGRATION.FORMAT_VERSION_MISSING' });
  });

  it('refuses a field it does not know', () => {
    const result = parseRefDocument({ formatVersion: 1, ...content, note: 'x' }, '/r/prod.json');
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.failure).toContain('note');
  });
});

describe('ref file format version 0, which a release candidate wrote', () => {
  it('converts to the version 1 document the format script writes, and parses into the same ref', () => {
    expect(refV1FromV0(content)).toEqual({ formatVersion: 1, ...content });
    expect(parseRefDocument(content, '/r/prod.json').assertOk()).toEqual(content);
  });

  it('drops the fields a ref does not have, which a release candidate ignored, as the format script does', () => {
    expect(refV1FromV0({ ...content, note: 'by hand' })).toEqual({ formatVersion: 1, ...content });
    expect(parseRefDocument({ ...content, note: 'by hand' }, '/r/prod.json').assertOk()).toEqual(
      content,
    );
  });

  it('is refused when it has no hash', () => {
    expect(parseRefDocument({ invariants: [] }, '/r/prod.json').ok).toBe(false);
  });
});
