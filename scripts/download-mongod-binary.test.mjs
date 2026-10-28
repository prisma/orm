import { deepStrictEqual, rejects } from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { downloadMongod, removeLockFiles } from './download-mongod-binary.mjs';

function writeExecutable(path, exitCode) {
  writeFileSync(path, `#!/bin/sh\nexit ${exitCode}\n`, { mode: 0o755 });
}

function fakeMongoMemoryServer(folder, { brokenBinary }) {
  const binaryCache = new Map([['8.2.6', brokenBinary]]);
  const downloads = [];
  const MongoBinary = {
    async getPath() {
      if (!binaryCache.has('8.2.6')) {
        const fresh = join(folder, 'mongod-fresh');
        writeExecutable(fresh, 0);
        downloads.push(fresh);
        binaryCache.set('8.2.6', fresh);
      }
      return binaryCache.get('8.2.6');
    },
  };
  return { MongoBinary, DryMongoBinary: { binaryCache }, downloads };
}

describe('downloadMongod', () => {
  it('deletes a binary that does not run, removes locks and downloads again', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'mongod-binaries-'));
    const brokenBinary = join(folder, 'mongod-broken');
    writeExecutable(brokenBinary, 1);
    writeFileSync(join(folder, '8.2.6.lock'), '');
    const fake = fakeMongoMemoryServer(folder, { brokenBinary });

    const binary = await downloadMongod({
      ...fake,
      folder,
      ownsBinary: true,
      wait: async () => {},
    });

    deepStrictEqual(
      { binary, downloads: fake.downloads, files: readdirSync(folder) },
      {
        binary: join(folder, 'mongod-fresh'),
        downloads: [join(folder, 'mongod-fresh')],
        files: ['mongod-fresh'],
      },
    );
  });

  it('keeps a configured system binary that does not run', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'mongod-binaries-'));
    const systemBinary = join(folder, 'mongod-system');
    writeExecutable(systemBinary, 1);
    const fake = fakeMongoMemoryServer(folder, { brokenBinary: systemBinary });
    fake.MongoBinary.getPath = async () => systemBinary;

    await rejects(
      downloadMongod({ ...fake, folder, ownsBinary: false, wait: async () => {} }),
      /mongod-system does not run:/,
    );
    deepStrictEqual(existsSync(systemBinary), true);
  });
});

describe('removeLockFiles', () => {
  it('removes lock files and keeps binaries', () => {
    const folder = mkdtempSync(join(tmpdir(), 'mongod-binaries-'));
    writeFileSync(join(folder, '8.2.6.lock'), '');
    writeFileSync(join(folder, 'mongod-x64-ubuntu-8.2.6'), '');
    mkdirSync(join(folder, 'nested.lock'));
    removeLockFiles(folder);
    deepStrictEqual(readdirSync(folder).sort(), ['mongod-x64-ubuntu-8.2.6', 'nested.lock']);
  });

  it('does nothing when the folder does not exist', () => {
    removeLockFiles(join(tmpdir(), 'mongod-binaries-missing-folder'));
  });
});
