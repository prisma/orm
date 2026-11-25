declare function build(): void;
declare namespace build {
  const version: string;
  interface Options {
    readonly fast: boolean;
  }
}
interface Both {
  readonly fromInterface: string;
}
declare class Both {
  readonly fromClass: number;
}
declare enum Level {
  Low = 0,
  High = 1
}
declare const enum Mode {
  On = "on",
  Off = "off"
}
type Pair = readonly [string, string];
declare const Pair: { readonly size: 2 };
declare const key: unique symbol;
interface Keyed {
  readonly [key]: string;
  [Symbol.iterator](): Iterator<string>;
  [name: string]: unknown;
  [index: number]: string;
}
declare class Accessors {
  set onlySet(value: string);
  get onlyGet(): number;
  get both(): string;
  set both(value: string);
}
declare const _default: {
  readonly answer: 42;
};
export { Accessors, Both, Keyed, Level, Mode, Pair, build, _default as default, key };
