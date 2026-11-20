import path from 'node:path'

import { expect, test } from 'vitest'

import { loadSchemaFiles } from './loadSchemaFiles'
import { CompositeFilesResolver, FilesResolver, FsEntryType, InMemoryFilesResolver, realFsResolver } from './resolver'
import { fixturePath, line, loadedFile } from './testUtils'

test('simple list', async () => {
  const files = await loadSchemaFiles(fixturePath('simple'))
  expect(files).toEqual([
    [fixturePath('simple', 'a.prisma'), line('// this is a')],
    [fixturePath('simple', 'b.prisma'), line('// this is b')],
  ])
})

test('ignores non *.prisma files', async () => {
  const files = await loadSchemaFiles(fixturePath('non-prisma-files'))
  expect(files).toEqual([
    [fixturePath('non-prisma-files', 'a.prisma'), line('// this is a')],
    [fixturePath('non-prisma-files', 'b.prisma'), line('// this is b')],
  ])
})

test('works with subfolders', async () => {
  const files = await loadSchemaFiles(fixturePath('subfolder'))
  expect(files).toEqual([
    loadedFile('subfolder', 'a.prisma'),
    [fixturePath('subfolder', 'nested', 'b.prisma'), line('// this is b')],
  ])
})

test('ignores *.prisma directories', async () => {
  const files = await loadSchemaFiles(fixturePath('with-directory'))
  expect(files).toEqual([[fixturePath('with-directory', 'a.prisma'), line('// this is a')]])
})

test('reads symlinks', async () => {
  const files = await loadSchemaFiles(fixturePath('symlink'))
  // link point to `simple` directory
  expect(files).toEqual([[fixturePath('simple', 'a.prisma'), line('// this is a')]])
})

test('ignores symlinks to directories', async () => {
  const files = await loadSchemaFiles(fixturePath('symlinks-to-dir'))
  expect(files).toEqual([])
})

test('does not get stuck on circular symlinks', async () => {
  const rootDir = path.join('/', 'root')
  const otherDir = path.join('/', 'other')
  // the root can also be reached under a different path, like `/tmp` and `/private/tmp` on macOS
  const rootAlias = path.join('/', 'alias-of-root')
  const canonical = (entryPath: string) => (entryPath === rootAlias ? rootDir : entryPath)
  // both directories contain a symlink to each other
  const dirs: Record<string, Record<string, FsEntryType>> = {
    [rootDir]: { 'a.prisma': { kind: 'file' }, link: { kind: 'symlink', realPath: otherDir } },
    [otherDir]: { 'b.prisma': { kind: 'file' }, link: { kind: 'symlink', realPath: rootDir } },
  }
  let lookups = 0
  const resolver: FilesResolver = {
    listDirContents: (dirPath) => Promise.resolve(Object.keys(dirs[canonical(dirPath)] ?? {})),
    getEntryType: (entryPath) => {
      // fails the test instead of running out of memory if the cycle is not detected
      if (++lookups > 20) {
        throw new Error('too many lookups: traversal did not terminate')
      }
      const realPath = canonical(entryPath)
      return Promise.resolve(
        dirs[realPath]
          ? { kind: 'directory', realPath }
          : dirs[canonical(path.dirname(entryPath))]?.[path.basename(entryPath)],
      )
    },
    getFileContents: (filePath) => Promise.resolve(`// this is ${path.basename(filePath)}`),
  }

  const files = await loadSchemaFiles(rootAlias, resolver)

  expect(files).toEqual([
    [path.join(rootAlias, 'a.prisma'), '// this is a.prisma'],
    [path.join(otherDir, 'b.prisma'), '// this is b.prisma'],
  ])
})

test('allows to use in-memory resolver', async () => {
  const resolver = new InMemoryFilesResolver({ caseSensitive: true })
  resolver.addFile(path.join('/', 'some', 'dir', 'a.prisma'), '// this is a')
  resolver.addFile(path.join('/', 'some', 'dir', 'b.prisma'), '// this is b')
  const files = await loadSchemaFiles('/some/dir', resolver)

  expect(files).toEqual([
    [path.join('/', 'some', 'dir', 'a.prisma'), '// this is a'],
    [path.join('/', 'some', 'dir', 'b.prisma'), '// this is b'],
  ])
})

test('allows to use composite resolver', async () => {
  const inMemory = new InMemoryFilesResolver({ caseSensitive: true })
  inMemory.addFile(fixturePath('simple', 'b.prisma'), line('// b is overridden'))
  inMemory.addFile(fixturePath('simple', 'c.prisma'), line('// in memory only'))

  const resolver = new CompositeFilesResolver(inMemory, realFsResolver, { caseSensitive: true })
  const files = await loadSchemaFiles(fixturePath('simple'), resolver)

  expect(files).toEqual([
    [fixturePath('simple', 'b.prisma'), line('// b is overridden')],
    [fixturePath('simple', 'c.prisma'), line('// in memory only')],
    [fixturePath('simple', 'a.prisma'), line('// this is a')],
  ])
})
