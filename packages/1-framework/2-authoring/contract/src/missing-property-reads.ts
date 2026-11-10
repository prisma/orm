/**
 * `object`, where a read of one of `names` that `object` does not have returns what `read` returns for it, or throws what `read` throws. Every other read and every other operation behaves as on `object`, which is not changed.
 */
export function answerMissingPropertyReads<T extends object>(
  object: T,
  names: ReadonlySet<string>,
  read: (name: string) => unknown,
): T {
  return new Proxy(object, {
    get(target, key, receiver) {
      if (typeof key === 'string' && names.has(key) && !(key in target)) return read(key);
      return Reflect.get(target, key, receiver);
    },
  });
}
