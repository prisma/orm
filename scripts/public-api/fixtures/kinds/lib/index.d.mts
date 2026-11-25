/** @deprecated Use `greet` instead. */
declare function hello(name: string): string;
declare function greet(name: string): string;
declare function greet(name: string, punctuation: string): string;
declare const answer: 42;
declare let counter: number;
declare const arrow: (value: number) => number;
interface Shape {
  readonly kind: string;
  label?: string;
  /** @deprecated Use `label`. */
  name?: string;
  area(): number;
  scale?(factor: number): Shape;
  (input: string): Shape;
  new (input: string): Shape;
  [key: string]: unknown;
}
declare abstract class Base {
  protected constructor(id: string);
  protected readonly id: string;
  abstract describe(): string;
}
declare class Circle extends Base {
  constructor(radius: number);
  static unit: Circle;
  readonly radius: number;
  diameter?: number;
  private secret;
  describe(): string;
}
type Pair<T> = readonly [T, T];
declare enum Color {
  Red = 0,
  Green = 1
}
declare namespace Units {
  const meter: number;
  function convert(value: number): number;
}
declare const defaultShape: Shape;
export { Base, Circle, Color, Pair, Shape, Units, answer, arrow, counter, defaultShape as default, greet, hello };
