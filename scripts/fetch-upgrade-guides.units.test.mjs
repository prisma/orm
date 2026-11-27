import { deepStrictEqual, doesNotThrow, rejects, strictEqual, throws } from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { gzipSync } from 'node:zlib';
import {
  checkIntegrity,
  chooseRelease,
  configuredRegistry,
  extractSkill,
  FetchUpgradeGuidesError,
  findPackageManager,
  putInPlace,
  releaseCandidates,
  tarFiles,
} from '../skills/prisma-8/scripts/fetch-upgrade-guides.mjs';
import {
  archive,
  fileEntry,
  integrityOf,
  padded,
  shasumOf,
  tarHeader,
} from './fetch-upgrade-guides.fixtures.mjs';

const PM = ['n', 'pm'].join('');
const variable = (name) => ['$', '{', name, '}'].join('');

async function withFolder(body) {
  const folder = await mkdtemp(join(tmpdir(), 'fetch-upgrade-guides-unit-'));
  try {
    return await body(folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

async function write(root, files) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), content);
  }
}

describe('releaseCandidates', () => {
  it('orders released versions newest first', () => {
    deepStrictEqual(
      releaseCandidates([
        '8.0.0-rc.9',
        '8.3.0-ea.5',
        '8.0.0-rc.10',
        '8.3.0',
        '8.3.0-preview.0',
        '8.0.1',
        '8.3.0-rc.0',
        '0.17.0',
        '9.0.0-ea.0',
      ]),
      [
        '9.0.0-ea.0',
        '8.3.0',
        '8.3.0-rc.0',
        '8.3.0-preview.0',
        '8.3.0-ea.5',
        '8.0.1',
        '8.0.0-rc.10',
        '8.0.0-rc.9',
        '0.17.0',
      ],
    );
  });

  it('leaves out development builds and other pre-releases', () => {
    deepStrictEqual(
      releaseCandidates(['8.1.0', '8.2.0-dev.3', '8.2.0-ea.1-dev.0', '8.2.0-beta.1', 'latest']),
      ['8.1.0'],
    );
  });

  it('keeps one major when asked', () => {
    deepStrictEqual(releaseCandidates(['8.1.0', '9.0.0', '8.0.1', '7.9.0'], 8), ['8.1.0', '8.0.1']);
  });
});

describe('chooseRelease', () => {
  const deprecatedAmong = (deprecated, asked) => async (versions) => {
    asked.push(versions);
    return new Set(versions.filter((version) => deprecated.includes(version)));
  };

  it('skips deprecated versions, asking about them in one call', async () => {
    const asked = [];
    deepStrictEqual(
      {
        chosen: await chooseRelease(
          ['8.3.0', '8.2.0', '8.1.0'],
          deprecatedAmong(['8.3.0'], asked),
          10,
        ),
        asked,
      },
      {
        chosen: { version: '8.2.0', deprecated: false, limited: false },
        asked: [['8.3.0', '8.2.0', '8.1.0']],
      },
    );
  });

  it('takes the newest when every version is deprecated', async () => {
    deepStrictEqual(
      await chooseRelease(['8.3.0', '8.2.0'], deprecatedAmong(['8.3.0', '8.2.0'], []), 10),
      {
        version: '8.3.0',
        deprecated: true,
        limited: false,
      },
    );
  });

  it('asks about the newest versions up to the limit only', async () => {
    const asked = [];
    deepStrictEqual(
      {
        chosen: await chooseRelease(
          ['8.3.0', '8.2.0', '8.1.0'],
          deprecatedAmong(['8.3.0', '8.2.0'], asked),
          2,
        ),
        asked,
      },
      {
        chosen: { version: '8.3.0', deprecated: true, limited: true },
        asked: [['8.3.0', '8.2.0']],
      },
    );
  });

  it('gives nothing for no candidates', async () => {
    strictEqual(await chooseRelease([], deprecatedAmong([], []), 10), undefined);
  });
});

function paths(entries) {
  return [...tarFiles(archive(entries))].map((file) => [file.path, file.content.toString()]);
}

describe('tarFiles', () => {
  it('joins the ustar prefix and the name', () => {
    const content = Buffer.from('hi');
    deepStrictEqual(
      paths([
        tarHeader({ name: 'file.md', prefix: 'package/skills', size: content.length }),
        padded(content),
      ]),
      [['package/skills/file.md', 'hi']],
    );
  });

  it('reads a GNU long name', () => {
    const name = Buffer.from(`package/${'a'.repeat(120)}.md\0`);
    const content = Buffer.from('long');
    deepStrictEqual(
      paths([
        tarHeader({ name: '././@LongLink', size: name.length, type: 'L' }),
        padded(name),
        tarHeader({ name: 'truncated', size: content.length }),
        padded(content),
      ]),
      [[`package/${'a'.repeat(120)}.md`, 'long']],
    );
  });

  it('reads a pax path with multi-byte characters', () => {
    const path = `package/${'é'.repeat(60)}/guide.md`;
    deepStrictEqual(paths([fileEntry(path, 'pax')]), [[path, 'pax']]);
  });

  it('skips links and folders', () => {
    deepStrictEqual(
      paths([
        tarHeader({ name: 'package/dir/', type: '5' }),
        tarHeader({ name: 'package/sym', type: '2', linkname: '/etc/passwd' }),
        tarHeader({ name: 'package/hard', type: '1', linkname: 'package/a' }),
        fileEntry('package/a', 'a'),
      ]),
      [['package/a', 'a']],
    );
  });

  it('refuses a negative size', () => {
    const header = tarHeader({ name: 'package/a' });
    header.write('-0000000001\0', 124);
    let sum = 0;
    header.write('        ', 148);
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    throws(() => [...tarFiles(archive([header, fileEntry('package/b', 'b')]))], /unreadable/);
  });

  it('refuses an entry cut short', () => {
    const whole = archive([fileEntry('package/a', 'x'.repeat(2000))]);
    throws(() => [...tarFiles(whole.subarray(0, 1024))], FetchUpgradeGuidesError);
  });
});

describe('extractSkill', () => {
  it('writes the whole skill tree and nothing else', () =>
    withFolder(async (folder) => {
      const tgz = gzipSync(
        archive([
          fileEntry('package/package.json', '{}'),
          fileEntry('package/skills/prisma-8/SKILL.md', 'skill'),
          fileEntry('package/skills/prisma-8/references/upgrade-app.md', 'ref'),
          fileEntry('package/skills/other/SKILL.md', 'other'),
        ]),
      );
      await extractSkill(tgz, join(folder, 'out'));
      deepStrictEqual(
        {
          top: (await readdir(join(folder, 'out'))).sort(),
          ref: await readFile(join(folder, 'out', 'references', 'upgrade-app.md'), 'utf-8'),
        },
        { top: ['SKILL.md', 'references'], ref: 'ref' },
      );
    }));

  it('refuses an entry that leaves the folder', () =>
    withFolder(async (folder) => {
      const tgz = gzipSync(
        archive([fileEntry('package/skills/prisma-8/../../../escape.md', 'bad')]),
      );
      await rejects(extractSkill(tgz, join(folder, 'out')), /outside/);
      deepStrictEqual(await readdir(folder), []);
    }));

  it('refuses a skill without SKILL.md', () =>
    withFolder(async (folder) => {
      const tgz = gzipSync(
        archive([fileEntry('package/skills/prisma-8/references/upgrade-app.md', 'ref')]),
      );
      await rejects(extractSkill(tgz, join(folder, 'out')), /SKILL\.md/);
      deepStrictEqual(await readdir(folder), []);
    }));

  it('refuses a tarball without the skill', () =>
    withFolder(async (folder) => {
      const tgz = gzipSync(archive([fileEntry('package/package.json', '{}')]));
      await rejects(extractSkill(tgz, join(folder, 'out')), /no skills\/prisma-8/);
    }));
});

describe('putInPlace', () => {
  it('puts the earlier copy back when the new one cannot be moved in', () =>
    withFolder(async (folder) => {
      await write(folder, { 'pkg-8.1.0/prisma-8/SKILL.md': 'earlier' });
      await rejects(putInPlace(folder, 'pkg-8.1.0', join(folder, 'missing')));
      deepStrictEqual(
        {
          entries: await readdir(folder),
          skill: await readFile(join(folder, 'pkg-8.1.0', 'prisma-8', 'SKILL.md'), 'utf-8'),
        },
        { entries: ['pkg-8.1.0'], skill: 'earlier' },
      );
    }));
});

describe('configuredRegistry', () => {
  const resolveIn = (files, env = {}) =>
    withFolder(async (folder) => {
      await write(folder, files);
      return configuredRegistry({
        packageName: '@prisma/orm-postgres',
        projectDir: join(folder, 'project'),
        homeDir: join(folder, 'home'),
        env: Object.fromEntries(
          Object.entries(env).map(([key, value]) => [
            key,
            value === 'ELSEWHERE' ? join(folder, 'elsewhere', 'npmrc') : value,
          ]),
        ),
      });
    });

  it('uses the public registry with no setting', async () => {
    strictEqual(await resolveIn({}), 'https://registry.npmjs.org');
  });

  it('reads npm_config_registry in any letter case', async () => {
    strictEqual(await resolveIn({}, { NPM_CONFIG_REGISTRY: 'http://env/' }), 'http://env/');
  });

  it("reads the project's .npmrc before the user's", async () => {
    strictEqual(
      await resolveIn({
        'project/.npmrc': 'registry=http://project/\n',
        'home/.npmrc': 'registry=http://home/\n',
      }),
      'http://project/',
    );
  });

  it("reads the user's .npmrc", async () => {
    strictEqual(await resolveIn({ 'home/.npmrc': 'registry=http://home/\n' }), 'http://home/');
  });

  it('takes a scoped line from any source before a plain one', async () => {
    strictEqual(
      await resolveIn(
        {
          'project/.npmrc': 'registry=http://project/\n',
          'home/.npmrc': '@prisma:registry=http://scoped/\n',
        },
        { npm_config_registry: 'http://env/' },
      ),
      'http://scoped/',
    );
  });

  it('removes quotes and expands environment variables', async () => {
    strictEqual(
      await resolveIn(
        { 'project/.npmrc': `registry="${variable('REG_HOST')}/npm/"\n` },
        { REG_HOST: 'http://x' },
      ),
      'http://x/npm/',
    );
  });

  it('refuses a variable that is not set', async () => {
    await rejects(resolveIn({ 'project/.npmrc': `registry=${variable('MISSING')}\n` }), /MISSING/);
  });

  it('reads .yarnrc.yml before any .npmrc', async () => {
    strictEqual(
      await resolveIn({
        'project/.yarnrc.yml': 'npmRegistryServer: "http://yarn/"\n',
        'home/.npmrc': '@prisma:registry=http://scoped/\n',
      }),
      'http://yarn/',
    );
  });

  it('reads a .yarnrc.yml value followed by a comment', async () => {
    strictEqual(
      await resolveIn({
        'project/.yarnrc.yml': 'npmRegistryServer: "http://yarn/" # internal mirror\n',
      }),
      'http://yarn/',
    );
    strictEqual(
      await resolveIn({ 'project/.yarnrc.yml': 'npmRegistryServer: http://yarn/ # mirror\n' }),
      'http://yarn/',
    );
  });

  it('reads the user config file that npm_config_userconfig names', async () => {
    strictEqual(
      await resolveIn(
        {
          'elsewhere/npmrc': 'registry=http://userconfig/\n',
          'home/.npmrc': 'registry=http://home/\n',
        },
        { NPM_CONFIG_USERCONFIG: 'ELSEWHERE' },
      ),
      'http://userconfig/',
    );
  });

  it('reads a scope in .yarnrc.yml', async () => {
    strictEqual(
      await resolveIn({
        'project/.yarnrc.yml':
          'npmRegistryServer: http://yarn/\nnpmScopes:\n  prisma:\n    npmRegistryServer: http://yarn-scope/\n',
      }),
      'http://yarn-scope/',
    );
  });

  it('reads YARN_NPM_REGISTRY_SERVER in a Yarn project', async () => {
    strictEqual(
      await resolveIn(
        { 'project/.yarnrc.yml': 'nodeLinker: node-modules\n' },
        { YARN_NPM_REGISTRY_SERVER: 'http://yarn-env/' },
      ),
      'http://yarn-env/',
    );
  });
});

describe('checkIntegrity', () => {
  const content = Buffer.from('tarball');

  it('accepts a matching sha512 or sha1 integrity', () => {
    doesNotThrow(() => checkIntegrity(content, { integrity: integrityOf(content) }, 'p@1'));
    const sha1 = `sha1-${Buffer.from(shasumOf(content), 'hex').toString('base64')}`;
    doesNotThrow(() => checkIntegrity(content, { integrity: sha1 }, 'p@1'));
  });

  it('compares only the strongest algorithm given', () => {
    const sha256 = `sha256-${createHash('sha256').update(content).digest('base64')}`;
    throws(
      () =>
        checkIntegrity(content, { integrity: `${integrityOf(Buffer.from('x'))} ${sha256}` }, 'p@1'),
      /does not match/,
    );
  });

  it('refuses a mismatch', () => {
    throws(
      () => checkIntegrity(content, { integrity: integrityOf(Buffer.from('x')) }, 'p@1'),
      /does not match/,
    );
  });

  it('falls back to shasum when no integrity algorithm is known', () => {
    doesNotThrow(() =>
      checkIntegrity(content, { integrity: 'md5-abc', shasum: shasumOf(content) }, 'p@1'),
    );
    throws(() => checkIntegrity(content, { shasum: shasumOf(Buffer.from('x')) }, 'p@1'), /shasum/);
  });

  it('refuses a tarball with no hash', () => {
    throws(() => checkIntegrity(content, {}, 'p@1'), /no integrity/);
  });
});

describe('findPackageManager', () => {
  it('finds the command on PATH', { skip: process.platform === 'win32' }, () =>
    withFolder(async (folder) => {
      await write(folder, { [`bin/${PM}`]: '#!/bin/sh\n' });
      await chmod(join(folder, 'bin', PM), 0o755);
      deepStrictEqual(
        findPackageManager({ PATH: `${join(folder, 'none')}:${join(folder, 'bin')}` }, 'darwin'),
        { command: join(folder, 'bin', PM), args: [] },
      );
    }),
  );

  it('gives nothing when it is not on PATH', () =>
    withFolder(async (folder) => {
      strictEqual(findPackageManager({ PATH: folder }, 'linux'), undefined);
    }));

  it('runs the script behind the Windows shim with node, not through a shell', () =>
    withFolder(async (folder) => {
      const cli = join(folder, 'node_modules', PM, 'bin', `${PM}-cli.js`);
      await write(folder, {
        [`${PM}.cmd`]: '@echo off\n',
        [`node_modules/${PM}/bin/${PM}-cli.js`]: '',
      });
      deepStrictEqual(findPackageManager({ Path: `C:\\none;${folder}` }, 'win32'), {
        command: process.execPath,
        args: [cli],
      });
    }));

  it('gives nothing for a Windows shim without its script', () =>
    withFolder(async (folder) => {
      await write(folder, { [`${PM}.cmd`]: '@echo off\n' });
      strictEqual(findPackageManager({ Path: folder }, 'win32'), undefined);
    }));
});
