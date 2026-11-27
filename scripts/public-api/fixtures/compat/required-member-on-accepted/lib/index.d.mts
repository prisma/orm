export interface CacheStore {
  get(key: string): string | undefined;
  delete(key: string): void;
}
export interface Middleware {
  readonly name: string;
}
export declare function createMiddleware(store: CacheStore): Middleware;
export declare function format(value: string | number): string;
export declare function preview_format(value: string | number): string;
export declare const version: string;
export interface Box<T> {
  readonly value: T;
}
export declare class Client {
  #private;
  private readonly secret;
  query(text: string): Promise<unknown>;
}
