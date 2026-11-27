import "fixture-registry";
interface NearestMethods {
  nearest(limit: number): string[];
}
declare module "fixture-registry" {
  interface Registry {
    readonly "x/nearest": NearestMethods;
  }
}
declare const version: string;
export { version };
export type { NearestMethods };
