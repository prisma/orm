type Count<N extends number, A extends unknown[] = []> = A["length"] extends N ? A : Count<N, [...A, unknown]>;
type Big = Count<1200>;
interface Holder {
  readonly value: string;
}
export type { Big, Holder };
