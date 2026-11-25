import { brand } from "./shared-AbCdEf12.mjs";
export interface Tagged {
  readonly [brand]: string;
  readonly name: string;
}
export declare function tag(name: string): Tagged;
