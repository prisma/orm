import { deepStrictEqual, match, strictEqual } from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { findPackageManager } from '../skills/prisma-8/scripts/fetch-upgrade-guides.mjs';
import {
  archive,
  fileEntry,
  integrityOf,
  shasumOf,
  tarball,
} from './fetch-upgrade-guides.fixtures.mjs';

const script = fileURLToPath(
  new URL('../skills/prisma-8/scripts/fetch-upgrade-guides.mjs', import.meta.url),
);
const run = promisify(execFile);

const PACKAGE = '@fake/orm-db';
const FOLDER = 'fake-orm-db';
const STEP = 'upgrading/app/upgrades/8.0.1-to-8.1.0/instructions.md';
const LONG_STEP =
  'upgrading/app/upgrades/8.0.1-to-8.1.0/scripts/a-script-folder-with-a-long-name/and-a-long-file-name-too.ts';
const TYPED_SCRIPT = "const answer: string = 'ran with types stripped';\nconsole.log(answer);\n";

function release(version, guide) {
  return tarball({
    'package.json': JSON.stringify({ name: PACKAGE, version }),
    'dist/index.mjs': 'export {};\n',
    'skills/prisma-8/SKILL.md': `skill ${version}\n`,
    'skills/prisma-8/references/upgrade-app.md': `reference ${version}\n`,
    [`skills/prisma-8/${STEP}`]: guide,
    [`skills/prisma-8/${LONG_STEP}`]: TYPED_SCRIPT,
  });
}

function versions(entries) {
  return Object.fromEntries(
    entries.map(([version, content, extra = {}]) => [version, { content, ...extra }]),
  );
}

const PACKAGES = {
  [PACKAGE]: {
    tags: { latest: '8.1.0', ea: '8.2.0-ea.0', dev: '8.3.0-ea.1-dev.3', next: '9.0.0-ea.0' },
    versions: versions([
      ['0.17.0', release('0.17.0', 'old major text\n')],
      ['8.0.0-rc.25', release('8.0.0-rc.25', 'rc text\n')],
      ['8.1.0', release('8.1.0', 'original text\n')],
      ['8.2.0-ea.0', release('8.2.0-ea.0', 'corrected text\n')],
      ['8.2.0', release('8.2.0', 'withdrawn 8 text\n'), { deprecated: 'broken, use 8.2.0-ea.0' }],
      ['8.3.0-ea.1-dev.3', release('8.3.0-ea.1-dev.3', 'development build text\n')],
      ['9.0.0-ea.0', release('9.0.0-ea.0', 'newest text\n')],
      ['9.0.0', release('9.0.0', 'withdrawn text\n'), { deprecated: 'broken, use 9.0.0-ea.0' }],
    ]),
  },
  '@fake/orm-withdrawn': {
    tags: { latest: '8.1.0' },
    versions: versions([
      ['8.0.1', release('8.0.1', 'older withdrawn\n'), { deprecated: 'bad' }],
      ['8.1.0', release('8.1.0', 'newest withdrawn\n'), { deprecated: 'bad' }],
    ]),
  },
  '@fake/orm-single': {
    tags: { latest: '8.1.0' },
    versions: versions([['8.1.0', release('8.1.0', 'single text\n')]]),
  },
  '@fake/orm-many-withdrawn': {
    tags: { latest: '8.12.0' },
    versions: versions([
      ['8.0.1', release('8.0.1', 'not withdrawn\n')],
      ...Array.from({ length: 12 }, (_, index) => {
        const version = `8.${index + 1}.0`;
        return [version, release(version, `withdrawn ${version}\n`), { deprecated: 'bad' }];
      }),
    ]),
  },
  '@fake/orm-tampered': {
    tags: { latest: '8.1.0' },
    versions: versions([
      ['8.1.0', release('8.1.0', 'x\n'), { integrity: integrityOf(Buffer.from('other')) }],
    ]),
  },
  '@fake/orm-hostile': {
    tags: { latest: '8.1.0' },
    versions: versions([
      [
        '8.1.0',
        gzipSync(
          archive([
            fileEntry('package/skills/prisma-8/SKILL.md', 'good\n'),
            fileEntry('package/skills/prisma-8/../../../../escape.md', 'bad\n'),
          ]),
        ),
      ],
    ]),
  },
  '@fake/orm-sha1': {
    tags: { latest: '8.1.0' },
    versions: versions([['8.1.0', release('8.1.0', 'sha1 text\n'), { integrity: undefined }]]),
  },
  '@fake/orm-nohash': {
    tags: { latest: '8.1.0' },
    versions: versions([
      ['8.1.0', release('8.1.0', 'x\n'), { integrity: undefined, shasum: undefined }],
    ]),
  },
};

function packument(name, origin) {
  const { tags, versions: all } = PACKAGES[name];
  return {
    name,
    'dist-tags': tags,
    versions: Object.fromEntries(
      Object.entries(all).map(([version, { content, ...extra }]) => [
        version,
        {
          name,
          version,
          ...(extra.deprecated === undefined ? {} : { deprecated: extra.deprecated }),
          dist: {
            tarball: `${origin}/tarballs/${encodeURIComponent(name)}/${version}.tgz`,
            integrity: 'integrity' in extra ? extra.integrity : integrityOf(content),
            shasum: 'shasum' in extra ? extra.shasum : shasumOf(content),
          },
        },
      ]),
    ),
  };
}

function serve(request, response) {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
  const origin = `http://${request.headers.host}`;
  const path = decodeURIComponent(url.pathname);
  const tarballPath = /^\/tarballs\/(.+)\/([^/]+)\.tgz$/.exec(path);
  if (tarballPath !== null) {
    const content = PACKAGES[tarballPath[1]]?.versions[tarballPath[2]]?.content;
    if (content !== undefined) {
      response.end(content);
      return;
    }
  }
  const name = path.slice(1);
  if (name === '@fake/orm-hang') return;
  if (name === '@fake/orm-locked') {
    response.statusCode = 401;
    response.end('{"error":"login first"}');
    return;
  }
  if (name === '@fake/orm-html') {
    response.setHeader('content-type', 'text/html');
    response.end('<html>sign in</html>');
    return;
  }
  if (PACKAGES[name] !== undefined) {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(packument(name, origin)));
    return;
  }
  response.statusCode = 404;
  response.end('{"error":"Not found"}');
}

const packageManager = findPackageManager(process.env, process.platform);
const PM = ['n', 'pm'].join('');

const FAKE_COMMAND = `
const { copyFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const [subcommand, ...rest] = process.argv.slice(2);
const mode = process.env.FAKE_MODE;
if (mode === 'hang') setInterval(() => {}, 1000);
else if (mode === 'crash') {
  process.stderr.write('starting\\nSegmentation fault\\n');
  process.exit(139);
} else if (subcommand === 'view' && rest.includes('versions')) {
  process.stdout.write(JSON.stringify(mode === 'single' ? '8.1.0' : ['8.1.0']));
} else if (subcommand === 'view') {
  process.stdout.write(JSON.stringify({ version: '8.1.0' }));
} else if (subcommand === 'pack' && mode === 'single') {
  const destination = rest.find((arg) => arg.startsWith('--pack-destination=')).split('=')[1];
  copyFileSync(process.env.FAKE_TARBALL, join(destination, 'fake-orm-db-8.1.0.tgz'));
  process.stdout.write(JSON.stringify([{ filename: 'fake-orm-db-8.1.0.tgz' }]));
} else if (subcommand === 'pack') {
  writeFileSync('fake-orm-db-8.1.0.tgz', 'not really a tarball');
  process.stdout.write(JSON.stringify([{ filename: 'fake-orm-db-8.1.0.tgz' }]));
}
`;
const DEAD = 'http://127.0.0.1:1';

describe('fetch-upgrade-guides', () => {
  let server;
  let origin;
  let sandbox;

  before(async () => {
    server = createServer(serve);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  async function newProject(files = {}) {
    sandbox = await realpath(await mkdtemp(join(tmpdir(), 'fetch-upgrade-guides-')));
    const all = {
      'project/package.json': JSON.stringify({ dependencies: { [PACKAGE]: '~8.1.0' } }),
      'project/pnpm-lock.yaml': 'lockfileVersion: 9.0\n',
      [`project/node_modules/${PACKAGE}/package.json`]: JSON.stringify({ version: '8.1.0' }),
      'home/.npmrc': `registry=${DEAD}/\n`,
      'empty/.keep': '',
      ...files,
    };
    for (const [path, content] of Object.entries(all)) {
      await mkdir(join(sandbox, path, '..'), { recursive: true });
      await writeFile(join(sandbox, path), content);
    }
    return join(sandbox, 'project');
  }

  async function snapshot(root) {
    const files = {};
    async function visit(dir) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '.prisma-upgrade-guides') await visit(path);
        } else {
          files[path] = await readFile(path, 'utf-8');
        }
      }
    }
    await visit(root);
    return files;
  }

  function environment(path, extra) {
    const kept = Object.entries(process.env).filter(
      ([key]) => !/^(npm_|yarn_|https?_proxy$|no_proxy$|node_use_env_proxy$)/i.test(key),
    );
    return {
      ...Object.fromEntries(kept),
      HOME: join(sandbox, 'home'),
      USERPROFILE: join(sandbox, 'home'),
      PATH: path,
      npm_config_userconfig: join(sandbox, 'home', '.npmrc'),
      npm_config_globalconfig: join(sandbox, 'global-npmrc'),
      npm_config_cache: join(sandbox, 'cache'),
      npm_config_fetch_retries: '0',
      npm_config_update_notifier: 'false',
      ...extra,
    };
  }

  async function fetchGuides(how, args, extra = {}) {
    const path =
      how === 'command'
        ? [dirname(process.execPath), dirname(packageManager.command)].join(delimiter)
        : join(sandbox, 'empty');
    const timeout = how === 'fake' ? 30_000 : 0;
    try {
      const { stdout, stderr } = await run(process.execPath, [script, ...args], {
        cwd: join(sandbox, 'project'),
        env: environment(path, extra),
        timeout,
      });
      return { code: 0, stdout, stderr };
    } catch (error) {
      return { code: error.code, stdout: error.stdout, stderr: error.stderr };
    }
  }

  async function inProject(files, body) {
    const project = await newProject(files);
    try {
      await body(project);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  }

  it('finds the package manager command for the command tests', () => {
    strictEqual(packageManager !== undefined, true, 'the command must be on PATH to run this test');
  });

  for (const how of ['command', 'built-in download']) {
    describe(`through the ${how}`, () => {
      it('extracts the skill of the newest release, which is not under latest', () =>
        inProject({}, async (project) => {
          const before = await snapshot(project);
          const result = await fetchGuides(how, [PACKAGE, '--registry', origin]);
          strictEqual(result.code, 0, result.stderr);
          const folder = join(
            project,
            '.prisma-upgrade-guides',
            `${FOLDER}-8.2.0-ea.0`,
            'prisma-8',
          );
          deepStrictEqual(
            {
              stdout: result.stdout,
              guide: await readFile(join(folder, STEP), 'utf-8'),
              reference: await readFile(join(folder, 'references', 'upgrade-app.md'), 'utf-8'),
              ignore: await readFile(
                join(project, '.prisma-upgrade-guides', '.gitignore'),
                'utf-8',
              ),
              project: await snapshot(project),
            },
            {
              stdout: `${folder}\n`,
              guide: 'corrected text\n',
              reference: 'reference 8.2.0-ea.0\n',
              ignore: '*\n',
              project: before,
            },
          );
          match(
            result.stderr,
            new RegExp(`${PACKAGE}@8\\.2\\.0-ea\\.0.*${FOLDER}-8\\.2\\.0-ea\\.0`),
          );
        }));

      it('takes the newest Prisma 8 release, skipping deprecated ones, development builds and other majors', () =>
        inProject({}, async (project) => {
          const result = await fetchGuides(how, [PACKAGE, '--registry', origin]);
          strictEqual(result.code, 0, result.stderr);
          strictEqual(
            await readFile(join(result.stdout.trim(), STEP), 'utf-8'),
            'corrected text\n',
          );
          strictEqual(result.stdout.trim().startsWith(project), true);
        }));

      it('takes another major when --major names it', () =>
        inProject({}, async () => {
          const result = await fetchGuides(how, [PACKAGE, '--registry', origin, '--major', '9']);
          strictEqual(result.code, 0, result.stderr);
          strictEqual(await readFile(join(result.stdout.trim(), STEP), 'utf-8'), 'newest text\n');
        }));

      it('reads a package with a single version', () =>
        inProject({}, async () => {
          const result = await fetchGuides(how, ['@fake/orm-single', '--registry', origin]);
          strictEqual(result.code, 0, result.stderr);
          strictEqual(await readFile(join(result.stdout.trim(), STEP), 'utf-8'), 'single text\n');
        }));

      it('stops looking past deprecated versions after ten and takes the newest', () =>
        inProject({}, async () => {
          const result = await fetchGuides(how, ['@fake/orm-many-withdrawn', '--registry', origin]);
          strictEqual(result.code, 0, result.stderr);
          strictEqual(
            await readFile(join(result.stdout.trim(), STEP), 'utf-8'),
            'withdrawn 8.12.0\n',
          );
          match(result.stderr, /newest 10 .*deprecated/);
        }));

      it('lets concurrent runs for the same version all succeed', () =>
        inProject({}, async () => {
          for (let round = 0; round < 2; round++) {
            const results = await Promise.all(
              Array.from({ length: 8 }, () => fetchGuides(how, [PACKAGE, '--registry', origin])),
            );
            deepStrictEqual(
              results.map((result) => result.code),
              results.map(() => 0),
              results.map((result) => result.stderr).join(''),
            );
            const folders = new Set(results.map((result) => result.stdout));
            strictEqual(folders.size, 1);
            strictEqual(
              await readFile(join([...folders][0].trim(), STEP), 'utf-8'),
              'corrected text\n',
            );
          }
        }));

      it("removes this package's stale temporary folders, and no others", () =>
        inProject(
          {
            [`project/.prisma-upgrade-guides/.download-${FOLDER}-8.1.0-aaaaaa/x.tgz`]: 'x',
            [`project/.prisma-upgrade-guides/.partial-${FOLDER}-8.1.0-bbbbbb/prisma-8/SKILL.md`]:
              'x',
            [`project/.prisma-upgrade-guides/.old-${FOLDER}-8.1.0-cccccc/prisma-8/SKILL.md`]: 'x',
            [`project/.prisma-upgrade-guides/.partial-${FOLDER}-8.2.0-ea.0-young1/prisma-8/SKILL.md`]:
              'x',
            'project/.prisma-upgrade-guides/.partial-fake-orm-db-extra-1.0.0-dddddd/SKILL.md': 'x',
            'project/.prisma-upgrade-guides/.partial-unrelated/SKILL.md': 'x',
          },
          async (project) => {
            const root = join(project, '.prisma-upgrade-guides');
            const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
            for (const entry of await readdir(root)) {
              if (!entry.includes('young'))
                await utimes(join(root, entry), twoHoursAgo, twoHoursAgo);
            }
            const result = await fetchGuides(how, [PACKAGE, '--registry', origin]);
            strictEqual(result.code, 0, result.stderr);
            deepStrictEqual((await readdir(root)).sort(), [
              '.gitignore',
              `.partial-${FOLDER}-8.2.0-ea.0-young1`,
              '.partial-fake-orm-db-extra-1.0.0-dddddd',
              '.partial-unrelated',
              `${FOLDER}-8.2.0-ea.0`,
            ]);
          },
        ));

      it('takes the newest deprecated release when every release is deprecated', () =>
        inProject({}, async () => {
          const result = await fetchGuides(how, ['@fake/orm-withdrawn', '--registry', origin]);
          strictEqual(result.code, 0, result.stderr);
          strictEqual(
            await readFile(join(result.stdout.trim(), STEP), 'utf-8'),
            'newest withdrawn\n',
          );
          match(result.stderr, /deprecated/);
        }));

      it('runs a TypeScript step script from the printed folder', () =>
        inProject({}, async () => {
          const result = await fetchGuides(how, [PACKAGE, '--registry', origin]);
          strictEqual(result.code, 0, result.stderr);
          const ran = await run(process.execPath, [join(result.stdout.trim(), LONG_STEP)]);
          strictEqual(ran.stdout, 'ran with types stripped\n');
        }));

      it("replaces the same version's folder and removes the package's other versions", () =>
        inProject(
          {
            [`project/.prisma-upgrade-guides/${FOLDER}-8.2.0-ea.0/prisma-8/stale.md`]: 'stale',
            [`project/.prisma-upgrade-guides/${FOLDER}-8.1.0/prisma-8/SKILL.md`]: 'old',
            'project/.prisma-upgrade-guides/fake-orm-db-extra-1.0.0/prisma-8/SKILL.md': 'other',
          },
          async (project) => {
            const result = await fetchGuides(how, [PACKAGE, '--registry', origin, '--major', '8']);
            strictEqual(result.code, 0, result.stderr);
            deepStrictEqual((await readdir(join(project, '.prisma-upgrade-guides'))).sort(), [
              '.gitignore',
              `${FOLDER}-8.2.0-ea.0`,
              'fake-orm-db-extra-1.0.0',
            ]);
            deepStrictEqual((await readdir(result.stdout.trim())).sort(), [
              'SKILL.md',
              'references',
              'upgrading',
            ]);
          },
        ));

      it('writes to --out when given', () =>
        inProject({}, async () => {
          const out = join(sandbox, 'out');
          const result = await fetchGuides(how, [PACKAGE, '--registry', origin, '--out', out]);
          strictEqual(result.code, 0, result.stderr);
          strictEqual(result.stdout, `${join(out, `${FOLDER}-8.2.0-ea.0`, 'prisma-8')}\n`);
        }));

      it('fails clearly when the registry does not have the package', () =>
        inProject({}, async () => {
          const result = await fetchGuides(how, ['@fake/orm-missing', '--registry', origin]);
          deepStrictEqual({ code: result.code, stdout: result.stdout }, { code: 1, stdout: '' });
          match(result.stderr, /^fetch-upgrade-guides: .*@fake\/orm-missing.*not found/);
          strictEqual(result.stderr.includes('    at '), false);
        }));

      it('fails clearly when the registry cannot be reached', () =>
        inProject({}, async () => {
          const result = await fetchGuides(how, [PACKAGE, '--registry', DEAD]);
          deepStrictEqual({ code: result.code, stdout: result.stdout }, { code: 1, stdout: '' });
          match(result.stderr, /could not reach/);
          match(result.stderr, /127\.0\.0\.1:1/);
          strictEqual(result.stderr.includes('    at '), false);
        }));

      it('fails clearly when the registry needs a login', () =>
        inProject({}, async () => {
          const result = await fetchGuides(how, ['@fake/orm-locked', '--registry', origin]);
          deepStrictEqual({ code: result.code, stdout: result.stdout }, { code: 1, stdout: '' });
          match(result.stderr, /log in/);
        }));

      it('fails when no release of the major exists', () =>
        inProject({}, async () => {
          const result = await fetchGuides(how, [PACKAGE, '--registry', origin, '--major', '7']);
          deepStrictEqual({ code: result.code, stdout: result.stdout }, { code: 1, stdout: '' });
          match(result.stderr, /no published 7\.x release/);
        }));

      it('refuses a tarball whose integrity does not match', () =>
        inProject({}, async (project) => {
          const result = await fetchGuides(how, ['@fake/orm-tampered', '--registry', origin]);
          deepStrictEqual({ code: result.code, stdout: result.stdout }, { code: 1, stdout: '' });
          match(result.stderr, /integrity/);
          deepStrictEqual(await readdir(join(project, '.prisma-upgrade-guides')), ['.gitignore']);
        }));

      it('leaves nothing behind when extraction fails partway', () =>
        inProject({}, async (project) => {
          const result = await fetchGuides(how, ['@fake/orm-hostile', '--registry', origin]);
          deepStrictEqual({ code: result.code, stdout: result.stdout }, { code: 1, stdout: '' });
          match(result.stderr, /outside/);
          deepStrictEqual(await readdir(join(project, '.prisma-upgrade-guides')), ['.gitignore']);
        }));
    });
  }

  describe('through the built-in download only', () => {
    it("uses the registry in the project's .npmrc", () =>
      inProject({ 'project/.npmrc': `@fake:registry=${origin}/\n` }, async () => {
        const result = await fetchGuides('built-in download', [PACKAGE]);
        strictEqual(result.code, 0, result.stderr);
      }));

    it('says no credentials were sent when the registry needs a login', () =>
      inProject({}, async () => {
        const result = await fetchGuides('built-in download', [
          '@fake/orm-locked',
          '--registry',
          origin,
        ]);
        match(result.stderr, /sends no credentials/);
      }));

    it('accepts a sha1 shasum when there is no integrity', () =>
      inProject({}, async () => {
        const result = await fetchGuides('built-in download', [
          '@fake/orm-sha1',
          '--registry',
          origin,
        ]);
        strictEqual(result.code, 0, result.stderr);
      }));

    it('refuses a tarball with no integrity and no shasum', () =>
      inProject({}, async () => {
        const result = await fetchGuides('built-in download', [
          '@fake/orm-nohash',
          '--registry',
          origin,
        ]);
        deepStrictEqual({ code: result.code, stdout: result.stdout }, { code: 1, stdout: '' });
        match(result.stderr, /no integrity/);
      }));

    it('says so when the registry does not answer with package metadata', () =>
      inProject({}, async () => {
        const result = await fetchGuides('built-in download', [
          '@fake/orm-html',
          '--registry',
          origin,
        ]);
        deepStrictEqual({ code: result.code, stdout: result.stdout }, { code: 1, stdout: '' });
        match(result.stderr, /did not answer with package metadata/);
      }));

    it('goes through the proxy in HTTP_PROXY', () =>
      inProject({}, async () => {
        const result = await fetchGuides(
          'built-in download',
          [PACKAGE, '--registry', 'http://registry.invalid'],
          { HTTP_PROXY: origin },
        );
        strictEqual(result.code, 0, result.stderr);
        strictEqual(await readFile(join(result.stdout.trim(), STEP), 'utf-8'), 'corrected text\n');
      }));
  });

  describe('through the command only', () => {
    it("gives up on a registry that does not answer, within the command's own fetch timeout", () =>
      inProject({}, async () => {
        const result = await fetchGuides('command', [
          '@fake/orm-hang',
          '--registry',
          origin,
          '--timeout',
          '1',
        ]);
        deepStrictEqual({ code: result.code, stdout: result.stdout }, { code: 1, stdout: '' });
        strictEqual(result.stderr.includes('did not finish'), false, result.stderr);
      }));

    it("passes the registry in a Yarn project's .yarnrc.yml to the command", () =>
      inProject({ 'project/.yarnrc.yml': `npmRegistryServer: "${origin}"\n` }, async () => {
        const result = await fetchGuides('command', [PACKAGE]);
        strictEqual(result.code, 0, result.stderr);
      }));
  });

  describe('through a command that misbehaves', () => {
    async function fakeCommand(mode, args) {
      const bin = join(sandbox, 'fake-bin');
      await mkdir(bin, { recursive: true });
      const path = join(bin, PM);
      await writeFile(path, `#!${process.execPath}\n${FAKE_COMMAND}`);
      await chmod(path, 0o755);
      const tarballPath = join(bin, 'release.tgz');
      await writeFile(tarballPath, release('8.1.0', 'single string text\n'));
      return fetchGuides('fake', args, { FAKE_MODE: mode, PATH: bin, FAKE_TARBALL: tarballPath });
    }

    it('reads a version list given as a single string', () =>
      inProject({}, async () => {
        const result = await fakeCommand('single', [PACKAGE]);
        strictEqual(result.code, 0, result.stderr);
        strictEqual(
          await readFile(join(result.stdout.trim(), STEP), 'utf-8'),
          'single string text\n',
        );
      }));

    it('is stopped when it does not finish in time', () =>
      inProject({}, async () => {
        const result = await fakeCommand('hang', [PACKAGE, '--timeout', '1']);
        deepStrictEqual({ code: result.code, stdout: result.stdout }, { code: 1, stdout: '' });
        match(result.stderr, /did not finish within 4 seconds/);
      }));

    it('reports the exit code and the last line it printed when it crashes', () =>
      inProject({}, async () => {
        const result = await fakeCommand('crash', [PACKAGE]);
        deepStrictEqual({ code: result.code, stdout: result.stdout }, { code: 1, stdout: '' });
        match(result.stderr, /exit code 139.*Segmentation fault/);
      }));

    it('reports a command too old to write to the pack destination, and removes its tarball', () =>
      inProject({}, async (project) => {
        const before = await snapshot(project);
        const result = await fakeCommand('old-pack', [PACKAGE]);
        deepStrictEqual({ code: result.code, stdout: result.stdout }, { code: 1, stdout: '' });
        match(result.stderr, /too old/);
        deepStrictEqual(await snapshot(project), before);
      }));
  });

  describe('arguments', () => {
    for (const [args, message] of [
      [[PACKAGE, '--major', '', '--registry', DEAD], /--major/],
      [[PACKAGE, '--major', '8x', '--registry', DEAD], /--major/],
      [[PACKAGE, '--timeout', '0', '--registry', DEAD], /--timeout/],
      [[PACKAGE, '--frobnicate', '--registry', DEAD], /usage/],
      [['--registry', DEAD], /usage/],
      [['--registry', DEAD, '--', '--userconfig=/etc/evil'], /not a package name/],
      [['https://example.invalid/x.tgz', '--registry', DEAD], /not a package name/],
      [[`${PACKAGE}@8.1.0`, '--registry', DEAD], /not a package name/],
      [['@Fake/Orm-db', '--registry', DEAD], /not a package name/],
      [[PACKAGE, '--registry=--userconfig=/etc/evil'], /not an http or https URL/],
      [[PACKAGE, '--registry', 'ftp://registry.example'], /not an http or https URL/],
    ]) {
      for (const how of ['command', 'built-in download']) {
        it(`refuses ${JSON.stringify(args)} through the ${how}`, () =>
          inProject({}, async () => {
            const result = await fetchGuides(how, args);
            deepStrictEqual({ code: result.code, stdout: result.stdout }, { code: 1, stdout: '' });
            match(result.stderr, message);
            strictEqual(result.stderr.includes('    at '), false);
          }));
      }
    }
  });
});
