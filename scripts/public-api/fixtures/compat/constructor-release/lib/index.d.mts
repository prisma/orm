export declare class Client {
  constructor(url: string | URL);
  query(text: string): Promise<unknown>;
}
