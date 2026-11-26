export declare function renamed(value: string): string;
export { renamed as ea_renamed };
export declare function assigned(value: string): string;
/** @deprecated */
export declare const ea_assigned: typeof assigned;
export interface Box<T> {
  readonly value: T;
}
/** @deprecated */
export type ea_Box<T> = Box<T>;
export interface Shape {
  readonly size: number;
}
/** @deprecated */
export type ea_Shape = Shape;
export type ea_Fixed<T> = Box<string>;
export declare function chained(value: string): string;
/** @deprecated */
export declare const preview_chained: typeof chained;
/** @deprecated */
export declare const ea_chained: typeof preview_chained;
export declare function preview_early(value: string): string;
/** @deprecated */
export declare const ea_early: typeof preview_early;
export declare function createClient(url: string): string;
export declare function ea_createClient(options: { url: string }): string;
