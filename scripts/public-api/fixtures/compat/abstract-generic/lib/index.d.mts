declare abstract class Hidden {
  abstract read(): string;
}
export type { Hidden };
export declare abstract class Base<Id extends string> {
  abstract readonly id: Id;
  abstract get size(): number;
  abstract run(input: Id): Id;
}
