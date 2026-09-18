import { describe, expect, it } from 'vitest';
import { DocumentStore } from '../src/document-store';

const uri = 'file:///abs/schema.psl';
const alias = 'file:///abs/%73chema.psl';

function open(store: DocumentStore, openedUri = alias, text = 'first') {
  return store.open({ uri: openedUri, languageId: 'prisma', version: 1, text });
}

describe('document store', () => {
  it('keeps document lookup bound when passed as a callback', () => {
    const store = new DocumentStore();
    const { getDocument } = store;
    expect(getDocument(uri)).toBeUndefined();
    const document = open(store);
    expect([uri, alias].map(getDocument)).toEqual([document, document]);
    store.close(alias);
    expect(getDocument(uri)).toBeUndefined();
  });

  it('owns one document per identity, preserving the latest opened URI', () => {
    const store = new DocumentStore();
    const first = open(store);
    expect(store.getDocument(uri)).toBe(first);
    expect(store.getDocument(alias)).toBe(first);
    expect(first.uri).toBe(alias);
    const replacement = open(store, uri, 'replacement');
    expect(store.getDocument(alias)).toBe(replacement);
    expect([...store.all()]).toEqual([replacement]);
    expect(replacement.uri).toBe(uri);
    expect(store.close(alias)).toBe(replacement);
    expect(store.getDocument(uri)).toBeUndefined();
    expect([...store.all()]).toEqual([]);
    expect(store.close(uri)).toBeUndefined();
    expect(open(store, uri).uri).toBe(uri);
  });

  it('applies ordered incremental and full edits through aliases with UTF-16 and CRLF indexing', () => {
    const store = new DocumentStore();
    const document = open(store, alias, '// 😀\r\nmodel User {}\r\n');
    expect(document.positionAt(7)).toEqual({ line: 1, character: 0 });
    const changed = store.change({ uri, version: 2 }, [
      { range: { start: { line: 0, character: 3 }, end: { line: 0, character: 5 } }, text: 'ok' },
      {
        range: { start: { line: 1, character: 6 }, end: { line: 1, character: 10 } },
        text: 'Post',
      },
    ]);
    expect(changed).toBe(document);
    expect(changed?.uri).toBe(alias);
    expect(changed?.version).toBe(2);
    expect(changed?.getText()).toBe('// ok\r\nmodel Post {}\r\n');
    expect(changed?.offsetAt({ line: 1, character: 6 })).toBe(13);
    expect(store.change({ uri: alias, version: 7 }, [{ text: 'full\r\n😀' }])).toBe(document);
    expect(document.getText()).toBe('full\r\n😀');
    expect(document.version).toBe(7);
    expect(document.positionAt(8)).toEqual({ line: 1, character: 2 });
  });

  it('ignores unopened changes and closes and skips empty edits without advancing versions', () => {
    const store = new DocumentStore();
    expect(store.change({ uri, version: 2 }, [{ text: 'ignored' }])).toBeUndefined();
    expect(store.close(uri)).toBeUndefined();
    const document = open(store);
    expect(store.change({ uri, version: 2 }, [])).toBeUndefined();
    expect(document.version).toBe(1);
    expect(document.getText()).toBe('first');
    expect(store.change({ uri, version: null }, [])).toBeUndefined();
    expect(() => store.change({ uri, version: null }, [{ text: 'invalid' }])).toThrow(
      `Received document change event for ${uri} without valid version identifier`,
    );
    expect(document.getText()).toBe('first');
  });
});
