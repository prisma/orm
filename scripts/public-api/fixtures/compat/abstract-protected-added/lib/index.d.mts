export declare abstract class Command {
  protected constructor(name: string);
  abstract run(): void;
  abstract stop(): void;
}
