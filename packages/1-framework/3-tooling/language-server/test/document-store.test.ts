import { statSync } from 'node:fs';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { join } from 'pathe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentStore } from '../src/document-store';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, statSync: vi.fn(actual.statSync) };
});

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

  describe('tagged content: overlay and disk', () => {
    const tempDirs: string[] = [];

    afterEach(async () => {
      for (const dir of tempDirs) {
        await rm(dir, { recursive: true, force: true });
      }
      tempDirs.length = 0;
    });

    async function fixtureFile(content: string): Promise<{ path: string; uri: string }> {
      const dir = await mkdtemp(join(tmpdir(), 'document-store-'));
      tempDirs.push(dir);
      const path = join(dir, 'member.prisma');
      await writeFile(path, content, 'utf8');
      return { path, uri: pathToFileURL(path).toString() };
    }

    it('reads a never-opened member from disk and caches it as a disk entry', async () => {
      const { uri: fileUri } = await fixtureFile('model Disk {}');
      const store = new DocumentStore();
      expect(store.text(fileUri)).toBe('model Disk {}');
      expect(store.getDocument(fileUri)).toBeUndefined();
    });

    it('skips stat for covered identities and reloads after invalidation', async () => {
      const file = await fixtureFile('first');
      const store = new DocumentStore();
      store.setWatchCoverage('project', [file.uri]);
      expect(store.text(file.uri)).toBe('first');
      vi.mocked(statSync).mockClear();
      await writeFile(file.path, 'second');
      expect(store.text(file.uri)).toBe('first');
      expect(store.text(file.uri)).toBe('first');
      expect(statSync).not.toHaveBeenCalled();
      store.invalidate(file.uri);
      expect(store.text(file.uri)).toBe('second');
      expect(statSync).toHaveBeenCalledTimes(1);
    });

    it('revalidates uncovered files independently of other project coverage', async () => {
      const watched = await fixtureFile('watched');
      const unwatched = await fixtureFile('before');
      const store = new DocumentStore();
      store.setWatchCoverage('watched-project', [watched.uri]);
      expect(store.text(unwatched.uri)).toBe('before');
      vi.mocked(statSync).mockClear();
      expect(store.text(unwatched.uri)).toBe('before');
      expect(statSync).toHaveBeenCalledTimes(1);
      await writeFile(unwatched.path, 'changed externally');
      expect(store.text(unwatched.uri)).toBe('changed externally');
    });

    it('discards disk text cached before gaining coverage even when metadata is unchanged', async () => {
      const file = await fixtureFile('first');
      const pinned = new Date('2020-01-01T00:00:00Z');
      await utimes(file.path, pinned, pinned);
      const store = new DocumentStore();
      expect(store.text(file.uri)).toBe('first');
      await writeFile(file.path, 'other');
      await utimes(file.path, pinned, pinned);
      store.setWatchCoverage('project', [file.uri]);
      expect(store.text(file.uri)).toBe('other');
      store.setWatchCoverage('project', []);
      expect(store.text(file.uri)).toBe('other');
      await writeFile(file.path, 'third');
      await utimes(file.path, pinned, pinned);
      store.setWatchCoverage('project', [file.uri]);
      expect(store.text(file.uri)).toBe('third');
    });

    it('retains shared coverage until the last owner removes it', async () => {
      const file = await fixtureFile('first');
      const store = new DocumentStore();
      store.setWatchCoverage('one', [file.uri]);
      store.setWatchCoverage('two', [file.uri]);
      expect(store.text(file.uri)).toBe('first');
      store.setWatchCoverage('one', []);
      vi.mocked(statSync).mockClear();
      expect(store.text(file.uri)).toBe('first');
      expect(statSync).not.toHaveBeenCalled();
      store.setWatchCoverage('two', []);
      expect(store.text(file.uri)).toBe('first');
      vi.mocked(statSync).mockClear();
      expect(store.text(file.uri)).toBe('first');
      expect(statSync).toHaveBeenCalledTimes(1);
    });

    it('canonicalizes coverage and stops trusting files removed from an owner', async () => {
      const previous = await fixtureFile('previous');
      const next = await fixtureFile('next');
      const store = new DocumentStore();
      store.setWatchCoverage('project', [previous.uri.replace('member.prisma', '%6dember.prisma')]);
      expect(store.text(previous.uri)).toBe('previous');
      vi.mocked(statSync).mockClear();
      expect(store.text(previous.uri)).toBe('previous');
      expect(statSync).not.toHaveBeenCalled();
      store.setWatchCoverage('project', [next.uri]);
      expect(store.text(previous.uri)).toBe('previous');
      vi.mocked(statSync).mockClear();
      expect(store.text(previous.uri)).toBe('previous');
      expect(statSync).toHaveBeenCalledTimes(1);
      await writeFile(previous.path, 'external change');
      expect(store.text(previous.uri)).toBe('external change');
    });

    it('preserves overlays across coverage changes and watcher invalidation', async () => {
      const file = await fixtureFile('disk');
      const store = new DocumentStore();
      const overlay = open(store, file.uri, 'overlay');
      store.setWatchCoverage('project', [file.uri]);
      store.invalidate(file.uri);
      store.setWatchCoverage('project', []);
      expect(store.text(file.uri)).toBe('overlay');
      expect(store.getDocument(file.uri)).toBe(overlay);
      store.setWatchCoverage('project', [file.uri]);
      store.close(file.uri);
      expect(store.text(file.uri)).toBe('disk');
    });

    it('returns a defined miss (never throws) for a nonexistent member', () => {
      const store = new DocumentStore();
      const missingUri = pathToFileURL(join(tmpdir(), 'document-store-missing.prisma')).toString();
      expect(() => store.text(missingUri)).not.toThrow();
      expect(store.text(missingUri)).toBeUndefined();
    });

    it('lets the overlay win over a cached disk entry', async () => {
      const { uri: fileUri } = await fixtureFile('model Disk {}');
      const store = new DocumentStore();
      expect(store.text(fileUri)).toBe('model Disk {}');
      const overlay = store.open({
        uri: fileUri,
        languageId: 'prisma',
        version: 1,
        text: 'model Overlay {}',
      });
      expect(store.text(fileUri)).toBe('model Overlay {}');
      expect(store.getDocument(fileUri)).toBe(overlay);
    });

    it('refreshes from disk after close, discarding the overlay text', async () => {
      const { uri: fileUri } = await fixtureFile('model DiskOriginal {}');
      const store = new DocumentStore();
      store.open({ uri: fileUri, languageId: 'prisma', version: 1, text: 'model Edited {}' });
      expect(store.close(fileUri)?.getText()).toBe('model Edited {}');
      expect(store.getDocument(fileUri)).toBeUndefined();
      expect(store.text(fileUri)).toBe('model DiskOriginal {}');
    });

    it('leaves a disk entry untouched when change targets it (existing unopened-change contract)', async () => {
      const { uri: fileUri } = await fixtureFile('model Disk {}');
      const store = new DocumentStore();
      expect(store.text(fileUri)).toBe('model Disk {}');
      expect(
        store.change({ uri: fileUri, version: 2 }, [{ text: 'model Mutated {}' }]),
      ).toBeUndefined();
      expect(store.text(fileUri)).toBe('model Disk {}');
    });

    it('is a no-op invalidating an overlay', async () => {
      const { uri: fileUri } = await fixtureFile('model Disk {}');
      const store = new DocumentStore();
      const overlay = store.open({
        uri: fileUri,
        languageId: 'prisma',
        version: 1,
        text: 'model Overlay {}',
      });
      store.invalidate(fileUri);
      expect(store.getDocument(fileUri)).toBe(overlay);
      expect(store.text(fileUri)).toBe('model Overlay {}');
    });

    it('evicts a disk entry on invalidate, forcing a fresh read on next access', async () => {
      const { path, uri: fileUri } = await fixtureFile('model Alpha {}');
      const store = new DocumentStore();
      const cachedMtime = new Date('2020-01-01T00:00:00Z');
      await utimes(path, cachedMtime, cachedMtime);
      expect(store.text(fileUri)).toBe('model Alpha {}');

      await writeFile(path, 'model Bravo {}', 'utf8');
      await utimes(path, cachedMtime, cachedMtime);
      expect(store.text(fileUri)).toBe('model Alpha {}');

      store.invalidate(fileUri);
      expect(store.text(fileUri)).toBe('model Bravo {}');
    });

    it('detects an mtime change with identical size and re-reads', async () => {
      const { path, uri: fileUri } = await fixtureFile('AAAA');
      const store = new DocumentStore();
      const older = new Date('2020-01-01T00:00:00Z');
      await utimes(path, older, older);
      expect(store.text(fileUri)).toBe('AAAA');

      await writeFile(path, 'BBBB', 'utf8');
      const newer = new Date('2020-01-02T00:00:00Z');
      await utimes(path, newer, newer);
      expect(store.text(fileUri)).toBe('BBBB');
    });

    it('detects a size change with an identical mtime and re-reads', async () => {
      const { path, uri: fileUri } = await fixtureFile('AA');
      const store = new DocumentStore();
      const pinned = new Date('2020-01-01T00:00:00Z');
      await utimes(path, pinned, pinned);
      expect(store.text(fileUri)).toBe('AA');

      await writeFile(path, 'AAAA', 'utf8');
      await utimes(path, pinned, pinned);
      expect(store.text(fileUri)).toBe('AAAA');
    });

    it('reuses the cached disk entry when mtime and size both match', async () => {
      const { path, uri: fileUri } = await fixtureFile('cached');
      const store = new DocumentStore();
      const pinned = new Date('2020-01-01T00:00:00Z');
      await utimes(path, pinned, pinned);
      expect(store.text(fileUri)).toBe('cached');

      await writeFile(path, 'MUTATE', 'utf8');
      await utimes(path, pinned, pinned);

      expect(store.text(fileUri)).toBe('cached');
    });
  });
});
