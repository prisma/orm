import { describe, expect, it } from 'vitest';
import {
  documentsWithObject,
  type Expression,
  holdsKey,
  objectsRewritePipeline,
  parseJsonPath,
  type StoredKeyPath,
  storedKeyPath,
} from '../src/core/migrations/stored-key-path';

function keyPath(field: string, path: string): StoredKeyPath {
  return storedKeyPath(field, path).assertOk();
}

const removeStreet = (object: Expression) => ({
  $unsetField: { field: { $literal: 'street' }, input: object },
});

const holdsStreet = (object: Expression) => holdsKey(object, 'street');

const getField = (key: string, input: Expression) => ({
  $getField: { field: { $literal: key }, input },
});

const isType = (value: Expression, type: string) => ({ $eq: [{ $type: value }, type] });

describe('parseJsonPath', () => {
  it('reads member names in shorthand and in brackets, and wildcards', () => {
    expect(parseJsonPath(`$[*].a['b c'].*["d"]`).assertOk()).toEqual({
      text: `$[*].a['b c'].*["d"]`,
      steps: [
        { kind: 'wildcard' },
        { kind: 'member', name: 'a' },
        { kind: 'member', name: 'b c' },
        { kind: 'wildcard' },
        { kind: 'member', name: 'd' },
      ],
    });
  });

  it('refuses any other JSONPath feature', () => {
    expect(parseJsonPath('$[0].a').assertNotOk()).toBe(
      'path "$[0].a" is not a JSONPath of member names (.name or [\'name\']) and wildcards ([*] or .*) from $',
    );
  });
});

describe('storedKeyPath', () => {
  it('splits a path into the steps to the objects and the key', () => {
    expect(keyPath('addresses', '$[*].street')).toEqual({
      field: 'addresses',
      path: {
        text: '$[*].street',
        steps: [{ kind: 'wildcard' }, { kind: 'member', name: 'street' }],
      },
      objects: [{ kind: 'wildcard' }],
      key: 'street',
    });
  });

  it('refuses a path that does not end at a key', () => {
    expect(storedKeyPath('addresses', '$[*]').assertNotOk()).toBe(
      'path "$[*]" does not end at a key',
    );
  });
});

describe('the path walk at $.a', () => {
  const path = keyPath('address', '$.street');

  it('rewrites the root object when the field holds an object, and leaves any other value', () => {
    expect(objectsRewritePipeline(path, removeStreet)).toEqual([
      {
        $set: {
          address: {
            $cond: [isType('$address', 'object'), removeStreet('$address'), '$address'],
          },
        },
      },
    ]);
  });

  it('matches the documents whose field holds an object that satisfies the condition', () => {
    expect(documentsWithObject(path, holdsStreet)).toEqual({
      $expr: {
        $cond: [
          isType('$address', 'object'),
          { $ne: [{ $type: getField('street', '$address') }, 'missing'] },
          false,
        ],
      },
    });
  });
});

describe('the path walk at $[*].a', () => {
  const path = keyPath('addresses', '$[*].street');

  it('maps over a list only, rewriting its object elements and leaving the others', () => {
    expect(objectsRewritePipeline(path, removeStreet)).toEqual([
      {
        $set: {
          addresses: {
            $cond: [
              isType('$addresses', 'array'),
              {
                $map: {
                  input: '$addresses',
                  as: 'element0',
                  in: {
                    $cond: [
                      isType('$$element0', 'object'),
                      removeStreet('$$element0'),
                      '$$element0',
                    ],
                  },
                },
              },
              '$addresses',
            ],
          },
        },
      },
    ]);
  });

  it('matches with $anyElementTrue over the elements, never a dot path', () => {
    expect(documentsWithObject(path, holdsStreet)).toEqual({
      $expr: {
        $cond: [
          isType('$addresses', 'array'),
          {
            $anyElementTrue: [
              {
                $map: {
                  input: '$addresses',
                  as: 'element0',
                  in: {
                    $cond: [isType('$$element0', 'object'), holdsStreet('$$element0'), false],
                  },
                },
              },
            ],
          },
          false,
        ],
      },
    });
  });
});

describe('the path walk at $.a[*].b', () => {
  const path = keyPath('profile', '$.addresses[*].street');
  const addresses = getField('addresses', '$profile');

  it('sets the key of the object to its rewritten list, with every name a literal', () => {
    expect(objectsRewritePipeline(path, removeStreet)).toEqual([
      {
        $set: {
          profile: {
            $cond: [
              isType('$profile', 'object'),
              {
                $cond: [
                  isType(addresses, 'array'),
                  {
                    $setField: {
                      field: { $literal: 'addresses' },
                      input: '$profile',
                      value: {
                        $map: {
                          input: addresses,
                          as: 'element0',
                          in: {
                            $cond: [
                              isType('$$element0', 'object'),
                              removeStreet('$$element0'),
                              '$$element0',
                            ],
                          },
                        },
                      },
                    },
                  },
                  '$profile',
                ],
              },
              '$profile',
            ],
          },
        },
      },
    ]);
  });

  it('matches through the object and over the list', () => {
    expect(documentsWithObject(path, holdsStreet)).toEqual({
      $expr: {
        $cond: [
          isType('$profile', 'object'),
          {
            $cond: [
              isType(addresses, 'array'),
              {
                $anyElementTrue: [
                  {
                    $map: {
                      input: addresses,
                      as: 'element0',
                      in: {
                        $cond: [isType('$$element0', 'object'), holdsStreet('$$element0'), false],
                      },
                    },
                  },
                ],
              },
              false,
            ],
          },
          false,
        ],
      },
    });
  });
});

describe('the path walk at a three-step path, $[*].lines[*].a', () => {
  const path = keyPath('orders', '$[*].lines[*].sku');
  const lines = getField('lines', '$$element0');

  it('maps over each list with its own variable', () => {
    expect(objectsRewritePipeline(path, removeStreet)).toEqual([
      {
        $set: {
          orders: {
            $cond: [
              isType('$orders', 'array'),
              {
                $map: {
                  input: '$orders',
                  as: 'element0',
                  in: {
                    $cond: [
                      isType('$$element0', 'object'),
                      {
                        $cond: [
                          isType(lines, 'array'),
                          {
                            $setField: {
                              field: { $literal: 'lines' },
                              input: '$$element0',
                              value: {
                                $map: {
                                  input: lines,
                                  as: 'element1',
                                  in: {
                                    $cond: [
                                      isType('$$element1', 'object'),
                                      removeStreet('$$element1'),
                                      '$$element1',
                                    ],
                                  },
                                },
                              },
                            },
                          },
                          '$$element0',
                        ],
                      },
                      '$$element0',
                    ],
                  },
                },
              },
              '$orders',
            ],
          },
        },
      },
    ]);
  });

  it('matches a document when an object in any inner list satisfies the condition', () => {
    expect(documentsWithObject(path, holdsStreet)).toEqual({
      $expr: {
        $cond: [
          isType('$orders', 'array'),
          {
            $anyElementTrue: [
              {
                $map: {
                  input: '$orders',
                  as: 'element0',
                  in: {
                    $cond: [
                      isType('$$element0', 'object'),
                      {
                        $cond: [
                          isType(lines, 'array'),
                          {
                            $anyElementTrue: [
                              {
                                $map: {
                                  input: lines,
                                  as: 'element1',
                                  in: {
                                    $cond: [
                                      isType('$$element1', 'object'),
                                      holdsStreet('$$element1'),
                                      false,
                                    ],
                                  },
                                },
                              },
                            ],
                          },
                          false,
                        ],
                      },
                      false,
                    ],
                  },
                },
              },
            ],
          },
          false,
        ],
      },
    });
  });
});
