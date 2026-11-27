import { deepStrictEqual, match, notStrictEqual, strictEqual } from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';

const script = fileURLToPath(
  new URL('../skills/prisma-8/scripts/fetch-upgrade-guides.mjs', import.meta.url),
);
const run = promisify(execFile);

const PACKAGE = '@fake/orm-db';
const STEP = 'upgrading/app/upgrades/8.0.1-to-8.1.0/instructions.md';
const LONG_STEP =
  'upgrading/app/upgrades/8.0.1-to-8.1.0/scripts/a-script-folder-with-a-long-name/and-a-long-file-name-too.mjs';

function octal(value, width) {
  return `${value.toString(8).padStart(width - 1, '0')}\0`;
}

function header(name, size, type) {
  const block = Buffer.alloc(512);
  block.write(name.slice(0, 100), 0, 'utf-8');
  block.write(octal(0o644, 8), 100);
  block.write(octal(0, 8), 108);
  block.write(octal(0, 8), 116);
  block.write(octal(size, 12), 124);
  block.write(octal(0, 12), 136);
  block.write('        ', 148);
  block.write(type, 156);
  block.write('ustar\0', 257);
  block.write('00', 263);
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return block;
}

function padded(content) {
  const rest = content.length % 512;
  return rest === 0 ? content : Buffer.concat([content, Buffer.alloc(512 - rest)]);
}

function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`;
  let length = body.length + 1;
  while (`${length}${body}`.length !== length) length++;
  return `${length}${body}`;
}

function tarball(files) {
  const blocks = [];
  for (const [name, text] of Object.entries(files)) {
    const content = Buffer.from(text, 'utf-8');
    const path = `package/${name}`;
    if (path.length > 100) {
      const pax = Buffer.from(paxRecord('path', path), 'utf-8');
      blocks.push(header('PaxHeader/long', pax.length, 'x'), padded(pax));
    }
    blocks.push(header(path, content.length, '0'), padded(content));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

function release(version, guide) {
  return tarball({
    'package.json': JSON.stringify({ name: PACKAGE, version }),
    'dist/index.mjs': 'export {};\n',
    [`skills/prisma-8/${STEP}`]: guide,
    [`skills/prisma-8/${LONG_STEP}`]: `// ${version}\n`,
    'skills/prisma-8/references/upgrade-app.md': 'not a guide\n',
  });
}

const RELEASES = {
  '8.0.0-rc.25': release('8.0.0-rc.25', 'rc text\n'),
  '8.0.1': release('8.0.1', 'original text\n'),
  '8.1.0': release('8.1.0', 'original text\n'),
  '8.2.0-ea.0': release('8.2.0-ea.0', 'corrected text\n'),
  '8.2.0-ea.1-dev.3': release('8.2.0-ea.1-dev.3', 'development build text\n'),
  '9.0.0': release('9.0.0', 'next major text\n'),
};

function integrityOf(content) {
  return `sha512-${createHash('sha512').update(content).digest('base64')}`;
}

function packument(origin, overrides = {}) {
  const versions = {};
  for (const [version, content] of Object.entries(RELEASES)) {
    versions[version] = {
      name: PACKAGE,
      version,
      dist: {
        tarball: `${origin}/tarballs/${version}.tgz`,
        integrity: overrides[version] ?? integrityOf(content),
      },
    };
  }
  return {
    name: PACKAGE,
    'dist-tags': { latest: '8.1.0', ea: '8.2.0-ea.0', dev: '8.2.0-ea.1-dev.3', next: '9.0.0' },
    versions,
  };
}

describe('fetch-upgrade-guides', () => {
  let server;
  let origin;
  let brokenIntegrity = false;
  let project;
  const requests = [];

  before(async () => {
    server = createServer((request, response) => {
      requests.push(request.url);
      if (request.url === '/@fake%2form-db' || request.url === '/@fake%2Form-db') {
        const overrides = brokenIntegrity ? { '8.2.0-ea.0': integrityOf(Buffer.from('x')) } : {};
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(packument(origin, overrides)));
        return;
      }
      const tarballMatch = /^\/tarballs\/(.+)\.tgz$/.exec(request.url ?? '');
      const content = tarballMatch === null ? undefined : RELEASES[tarballMatch[1]];
      if (content !== undefined) {
        response.end(content);
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: 'Not found' }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  async function newProject(files = {}) {
    project = await mkdtemp(join(tmpdir(), 'fetch-upgrade-guides-'));
    const all = {
      'package.json': JSON.stringify({ dependencies: { [PACKAGE]: '~8.0.1' } }),
      'pnpm-lock.yaml': 'lockfileVersion: 9.0\n',
      [`node_modules/${PACKAGE}/package.json`]: JSON.stringify({ name: PACKAGE, version: '8.0.1' }),
      ...files,
    };
    for (const [path, content] of Object.entries(all)) {
      await mkdir(join(project, path, '..'), { recursive: true });
      await writeFile(join(project, path), content);
    }
    return project;
  }

  async function snapshot(root) {
    const files = {};
    async function visit(dir) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '.cache' && entry.name !== '.home') await visit(path);
        } else {
          files[path] = await readFile(path, 'utf-8');
        }
      }
    }
    await visit(root);
    return files;
  }

  async function fetchGuides(args, cwd = project) {
    const home = join(project, '.home');
    await mkdir(home, { recursive: true });
    await writeFile(join(home, '.npmrc'), 'registry=http://127.0.0.1:1/\n');
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'npm_config_registry'),
    );
    try {
      const { stdout, stderr } = await run(process.execPath, [script, ...args], {
        cwd,
        env: { ...env, HOME: home, USERPROFILE: home },
      });
      return { code: 0, stdout, stderr };
    } catch (error) {
      return { code: error.code, stdout: error.stdout, stderr: error.stderr };
    }
  }

  async function cleanUp() {
    await rm(project, { recursive: true, force: true });
  }

  it('reads a step guide from the newest release of the installed major, not the latest tag', async () => {
    await newProject();
    try {
      const before = await snapshot(project);
      const result = await fetchGuides([PACKAGE, '--registry', origin]);
      strictEqual(result.code, 0, result.stderr);
      const folder = result.stdout.trim();
      deepStrictEqual(
        {
          guide: await readFile(join(folder, '..', STEP), 'utf-8'),
          longPath: await readFile(join(folder, '..', LONG_STEP), 'utf-8'),
          entries: await readdir(join(folder, '..')),
        },
        { guide: 'corrected text\n', longPath: '// 8.2.0-ea.0\n', entries: ['upgrading'] },
      );
      match(folder, /8\.2\.0-ea\.0/);
      match(folder, /upgrading$/);
      deepStrictEqual(await snapshot(project), before);
    } finally {
      await cleanUp();
    }
  });

  it('leaves out development builds and later majors', async () => {
    await newProject();
    try {
      const result = await fetchGuides([PACKAGE, '--registry', origin]);
      strictEqual(result.code, 0, result.stderr);
      const guide = await readFile(join(result.stdout.trim(), '..', STEP), 'utf-8');
      notStrictEqual(guide, 'development build text\n');
      notStrictEqual(guide, 'next major text\n');
    } finally {
      await cleanUp();
    }
  });

  it('takes the major from the installed copy, or from --major', async () => {
    await newProject({
      [`node_modules/${PACKAGE}/package.json`]: JSON.stringify({ name: PACKAGE, version: '9.0.0' }),
    });
    try {
      const installed = await fetchGuides([PACKAGE, '--registry', origin]);
      const explicit = await fetchGuides([PACKAGE, '--registry', origin, '--major', '8']);
      deepStrictEqual(
        {
          installed: await readFile(join(installed.stdout.trim(), '..', STEP), 'utf-8'),
          explicit: await readFile(join(explicit.stdout.trim(), '..', STEP), 'utf-8'),
        },
        { installed: 'next major text\n', explicit: 'corrected text\n' },
      );
    } finally {
      await cleanUp();
    }
  });

  it('writes to --out when given', async () => {
    await newProject();
    const out = await mkdtemp(join(tmpdir(), 'fetch-upgrade-guides-out-'));
    try {
      const result = await fetchGuides([PACKAGE, '--registry', origin, '--out', out]);
      strictEqual(result.code, 0, result.stderr);
      strictEqual(result.stdout.trim().startsWith(out), true);
      strictEqual(
        await readFile(join(result.stdout.trim(), '..', STEP), 'utf-8'),
        'corrected text\n',
      );
    } finally {
      await cleanUp();
      await rm(out, { recursive: true, force: true });
    }
  });

  it("uses the registry in the project's .npmrc", async () => {
    await newProject({ '.npmrc': `@fake:registry=${origin}/\n` });
    try {
      requests.length = 0;
      const result = await fetchGuides([PACKAGE]);
      strictEqual(result.code, 0, result.stderr);
      strictEqual(requests.length > 0, true);
    } finally {
      await cleanUp();
    }
  });

  it('fails clearly when the registry does not have the package', async () => {
    await newProject();
    try {
      const result = await fetchGuides(['@fake/orm-missing', '--registry', origin]);
      strictEqual(result.code, 1);
      match(result.stderr, /@fake\/orm-missing/);
      match(result.stderr, /not found/);
      strictEqual(result.stdout, '');
    } finally {
      await cleanUp();
    }
  });

  it('fails clearly when the registry cannot be reached', async () => {
    await newProject();
    const closed = createServer();
    await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const unreachable = `http://127.0.0.1:${closed.address().port}`;
    await new Promise((resolve) => closed.close(resolve));
    try {
      const result = await fetchGuides([PACKAGE, '--registry', unreachable]);
      strictEqual(result.code, 1);
      match(result.stderr, /could not reach/);
      match(result.stderr, new RegExp(unreachable.replaceAll('.', '\\.')));
    } finally {
      await cleanUp();
    }
  });

  it('fails when no release of the major exists', async () => {
    await newProject();
    try {
      const result = await fetchGuides([PACKAGE, '--registry', origin, '--major', '7']);
      strictEqual(result.code, 1);
      match(result.stderr, /no published 7\.x release/);
    } finally {
      await cleanUp();
    }
  });

  it('refuses a tarball whose integrity does not match', async () => {
    await newProject();
    brokenIntegrity = true;
    try {
      const result = await fetchGuides([PACKAGE, '--registry', origin]);
      strictEqual(result.code, 1);
      match(result.stderr, /integrity/);
    } finally {
      brokenIntegrity = false;
      await cleanUp();
    }
  });
});
