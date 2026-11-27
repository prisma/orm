import "fixture-registry";
interface NearestMethods {
  nearest(limit: 1): string[];
}
declare module "fixture-registry" {
  interface Registry {
    readonly "x/nearest": NearestMethods;
  }
}
declare const version: string;
export { version };
export type { NearestMethods };
