/** What the adapter asked of the ORM client: each method name called, and each row result it awaited. */
export interface Recording {
  readonly calls: string[];
  readonly results: unknown[];
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof Reflect.get(value, 'then') === 'function'
  );
}

function record(value: unknown, recording: Recording): unknown {
  if (isThenable(value)) {
    return Promise.resolve(value).then((result) => {
      recording.results.push(result);
      return result;
    });
  }
  if (typeof value !== 'object' || value === null) return value;
  return new Proxy(value, {
    get(target, property) {
      const member: unknown = Reflect.get(target, property, target);
      if (typeof member === 'function') {
        return (...args: unknown[]) => {
          if (typeof property === 'string') recording.calls.push(property);
          return record(Reflect.apply(member, target, args), recording);
        };
      }
      return typeof member === 'object' && member !== null ? record(member, recording) : member;
    },
  });
}

/**
 * The client with its `orm` wrapped so that every collection method the adapter calls, and every result it awaits, is recorded. Transactions are not recorded.
 */
export function recordingClient<T extends { readonly orm: object }>(
  client: T,
): { readonly client: T; readonly recording: Recording } {
  const recording: Recording = { calls: [], results: [] };
  const wrapped = new Proxy(client, {
    get(target, property) {
      const member: unknown = Reflect.get(target, property, target);
      if (property === 'orm') return record(member, recording);
      return typeof member === 'function' ? member.bind(target) : member;
    },
  });
  return { client: wrapped, recording };
}
