export declare function renamed(value: string): string;
export declare function assigned(value: string): string;
export interface Box<T> {
  readonly value: T;
}
export interface Shape {
  readonly size: number;
}
export declare function chained(value: string): string;
/** @deprecated */
export declare const preview_chained: typeof chained;
export declare function preview_early(value: string): string;
export declare function createClient(url: string): string;
export declare const reversed: (value: string) => string;
export declare function walked(value: string): string;
export { fwdFn } from "fixture-fwd-dep";
