import { lstat } from 'node:fs/promises';
import { dirname, isAbsolute, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { structuredError } from '@internal/utils/structured-error';
import { FSWatcher } from 'chokidar';

interface WatchCallbacks {
  readonly onReady: () => void;
  readonly onChange: (path: string) => void;
  readonly onError: (error: unknown) => void;
}

export async function watchRoots(inputs: readonly string[]): Promise<string[]> {
  const roots: string[] = [];
  for (const input of inputs) {
    if (input.startsWith('!') && !input.startsWith('!(')) continue;
    const path = input.startsWith('file:') ? fileURLToPath(input) : input;
    if (!isAbsolute(path))
      throw structuredError('LSP.WATCH_UNAVAILABLE', `Watch input is not absolute: ${input}`);
    const parts = (sep === '\\' ? path.replaceAll('/', sep) : path).split(sep);
    const boundary = parts.findIndex((part) => /[*?\\()[\]{}]/.test(part));
    if (boundary >= 0 && /(?:^|[/\\({,|])\.\.(?:$|[/\\)},|])/.test(path)) {
      throw structuredError(
        'LSP.WATCH_UNAVAILABLE',
        `Dynamic parent traversal is unsupported: ${input}`,
      );
    }
    let root = boundary < 0 ? dirname(path) : parts.slice(0, boundary).join(sep) || sep;
    root = resolve(root);
    while (true) {
      if (root === parse(root).root)
        throw structuredError(
          'LSP.WATCH_UNAVAILABLE',
          `Refusing recursive filesystem root watch: ${root}`,
        );
      try {
        const stats = await lstat(root);
        if (stats.isSymbolicLink())
          throw structuredError(
            'LSP.WATCH_UNAVAILABLE',
            `Symbolic watch root is unsupported: ${root}`,
          );
        if (stats.isDirectory()) break;
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
      root = dirname(root);
    }
    for (
      let ancestor = dirname(root);
      ancestor !== dirname(ancestor);
      ancestor = dirname(ancestor)
    ) {
      if ((await lstat(ancestor)).isSymbolicLink())
        throw structuredError(
          'LSP.WATCH_UNAVAILABLE',
          `Symbolic watch ancestor is unsupported: ${ancestor}`,
        );
    }
    roots.push(root);
  }
  return [...new Set(roots)].filter(
    (root, index, all) =>
      !all.some((other, otherIndex) => otherIndex !== index && isWithin(other, root)),
  );
}

function isWithin(root: string, path: string): boolean {
  const child = relative(root, path);
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child));
}

export class InternalWatcher {
  readonly #watchers: FSWatcher[] = [];
  readonly #startup: Promise<void>;
  #closed = false;

  constructor(configPath: string, inputs: readonly string[], callbacks: WatchCallbacks) {
    this.#startup = this.#start(configPath, inputs, callbacks).catch(callbacks.onError);
  }

  async #start(
    configPath: string,
    inputs: readonly string[],
    callbacks: WatchCallbacks,
  ): Promise<void> {
    const roots = await watchRoots(inputs);
    if (this.#closed) return;
    const configsOnly = !roots.some((root) => isWithin(root, configPath));
    const subscriptions = [
      ...(roots.length > 0 ? [{ paths: roots, configOnly: false }] : []),
      ...(configsOnly ? [{ paths: [dirname(configPath)], configOnly: true }] : []),
    ];
    let pending = subscriptions.length;
    for (const subscription of subscriptions) {
      const reportedSymlinks = new Set<string>();
      const watcher = new FSWatcher({
        persistent: false,
        ignoreInitial: true,
        usePolling: false,
        followSymlinks: false,
        ...(subscription.configOnly ? { depth: 0 } : {}),
        ignored: (path, stats) => {
          if (stats?.isSymbolicLink()) {
            if (!reportedSymlinks.has(path)) {
              reportedSymlinks.add(path);
              callbacks.onError(
                structuredError(
                  'LSP.WATCH_UNAVAILABLE',
                  `Symbolic watch path is unsupported: ${path}`,
                ),
              );
            }
            return true;
          }
          return subscription.configOnly && path !== dirname(configPath) && path !== configPath;
        },
      });
      this.#watchers.push(watcher);
      if (watcher.options.usePolling) {
        await watcher.close();
        throw structuredError(
          'LSP.WATCH_UNAVAILABLE',
          'Internal file watching cannot enable polling',
        );
      }
      watcher.on('error', callbacks.onError);
      watcher.on('all', (_event, path) => {
        if (!this.#closed) callbacks.onChange(path);
      });
      watcher.on('ready', () => {
        if (--pending === 0 && !this.#closed) callbacks.onReady();
      });
      watcher.add(subscription.paths);
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    await this.#startup;
    await Promise.all(this.#watchers.map((watcher) => watcher.close()));
  }
}
