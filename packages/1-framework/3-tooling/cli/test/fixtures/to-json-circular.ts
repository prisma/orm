class Node {
  readonly name = 'node';

  toJSON(): unknown {
    const loop: Record<string, unknown> = {};
    loop['self'] = loop;
    return loop;
  }
}

export const contract = { node: new Node() };
