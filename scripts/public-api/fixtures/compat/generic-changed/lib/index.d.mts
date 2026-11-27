interface Optional {
  readonly optional: true;
}
interface Arg<T> {
  readonly type: T;
}
type OutOf<T> = T extends Arg<infer V> ? V : never;
declare function required<P extends Record<string, Arg<unknown>>>(
  shape: P,
): { [K in keyof P as P[K] extends Optional ? never : K]: unknown };
export { required };
