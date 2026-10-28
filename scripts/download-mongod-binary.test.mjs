import { deepStrictEqual } from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { removeLockFiles } from './download-mongod-binary.mjs';

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
