import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { InternalWatcher, watchRoots } from '../src/internal-watcher';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups.length = 0;
  vi.unstubAllEnvs();
});
async function directory() {
  const dir = await mkdtemp(join(tmpdir(), 'internal-watcher-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
it('derives literal safe roots for glob syntax and future directories', async () => {
  const dir = await directory();
  await mkdir(join(dir, 'schemas'));
  expect(
    await watchRoots([
      join(dir, 'schemas/@(user|post)/*.prisma'),
      join(dir, 'schemas/{one,two}/**/*.prisma'),
      join(dir, 'schemas/[[]id[]]/schema.prisma'),
      join(dir, 'schemas/[!a]/schema.prisma'),
      join(dir, 'schemas/!(user)/schema.prisma'),
      join(dir, 'schemas/{1..3}/schema.prisma'),
    ]),
  ).toEqual([join(dir, 'schemas')]);
  expect(await watchRoots([join(dir, 'missing/deeper/*.prisma')])).toEqual([dir]);
  expect(await watchRoots([join(dir, 'schema.prisma')])).toEqual([dir]);
  await expect(watchRoots(['/**/*.prisma'])).rejects.toThrow('root');
  await mkdir(join(dir, '{one'));
  expect(await watchRoots([join(dir, '{one/nested,two}/**/*.prisma')])).toEqual([dir]);
  await expect(watchRoots([`${dir}/*/../../*.prisma`])).rejects.toThrow('traversal');
});
it.each(['*', '?', '[unfinished', '{literal}', '@(one|two)', '!(one)'])(
  'uses a conservative root boundary for %s outside the config directory',
  async (segment) => {
    const dir = await directory();
    await mkdir(join(dir, segment));
    expect(await watchRoots([join(dir, segment, 'nested/schema.prisma')])).toEqual([dir]);
    await expect(watchRoots([`${dir}/${segment}/../../schema.prisma`])).rejects.toThrow(
      'traversal',
    );
  },
);
it('refuses an environment override that would enable polling', async () => {
  const dir = await directory();
  vi.stubEnv('CHOKIDAR_USEPOLLING', 'true');
  const onError = vi.fn();
  const onReady = vi.fn();
  const watcher = new InternalWatcher(join(dir, 'prisma.config.ts'), [], {
    onReady,
    onError,
    onChange: vi.fn(),
  });
  cleanups.push(() => watcher.close());
  await vi.waitFor(() =>
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('polling') }),
    ),
  );
  expect(onReady).not.toHaveBeenCalled();
});
it('observes real external changes and atomic config replacement', async () => {
  const dir = await directory();
  const schemas = join(dir, 'schemas');
  await mkdir(schemas);
  const config = join(dir, 'prisma.config.ts');
  await writeFile(config, 'first');
  const onReady = vi.fn();
  const onChange = vi.fn();
  const onError = vi.fn();
  const watcher = new InternalWatcher(config, [join(schemas, '**/*.prisma')], {
    onReady,
    onChange,
    onError,
  });
  cleanups.push(() => watcher.close());
  await vi.waitFor(() => expect(onReady).toHaveBeenCalledOnce());
  const member = join(schemas, 'new.prisma');
  await writeFile(member, 'first');
  await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(member));
  onChange.mockClear();
  await writeFile(member, 'second');
  await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(member));
  await rm(config);
  await writeFile(config, 'replacement');
  await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(config));
  expect(onError).not.toHaveBeenCalled();
});
