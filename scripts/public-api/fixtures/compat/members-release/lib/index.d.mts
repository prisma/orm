interface Optional {
  readonly optional: true;
}
interface Arg<T> {
  readonly type: T;
}
type OutOf<T> = T extends Arg<infer V> ? V : never;
interface Shape {
  required<P extends Record<string, Arg<unknown>>>(shape: P): { [K in keyof P as P[K] extends Optional ? never : K]: OutOf<P[K]> };
  pick<T extends string>(value: T): T;
}
export type { Shape };
