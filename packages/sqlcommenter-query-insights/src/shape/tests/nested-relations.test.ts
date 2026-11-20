import { describe, expect, it } from 'vitest'

import { shapeQuery } from '../shape'

describe('shapeQuery - nested relations', () => {
  describe('example 6: mixed select with nested include', () => {
    it('uses select at top level, include for nested relations with $scalars', () => {
      const ARGS1 = { where: { active: true } }
      const ARGS2 = { take: 10 }
      const ARGS3 = { orderBy: { createdAt: 'desc' } }

      const before = {
        arguments: ARGS1,
        selection: {
          name: true,
          posts: {
            arguments: ARGS2,
            selection: {
              $scalars: true,
              $composites: true,
              comments: {
                arguments: ARGS3,
                selection: {
                  $scalars: true,
                  $composites: true,
                },
              },
            },
          },
        },
      }

      const after = {
        ...ARGS1,
        select: {
          name: true,
          posts: {
            ...ARGS2,
            include: {
              comments: {
                ...ARGS3,
              },
            },
          },
        },
      }

      expect(shapeQuery(before)).toEqual(after)
    })
  })

  describe('example 7: nested relation simplified to true with empty arguments', () => {
    it('simplifies deepest relation to true when arguments are empty', () => {
      const ARGS1 = { where: { id: 1 } }
      const ARGS2 = { skip: 5 }

      const before = {
        arguments: ARGS1,
        selection: {
          name: true,
          posts: {
            arguments: ARGS2,
            selection: {
              $scalars: true,
              $composites: true,
              comments: {
                arguments: {},
                selection: {
                  $scalars: true,
                  $composites: true,
                },
              },
            },
          },
        },
      }

      const after = {
        ...ARGS1,
        select: {
          name: true,
          posts: {
            ...ARGS2,
            include: {
              comments: true,
            },
          },
        },
      }

      expect(shapeQuery(before)).toEqual(after)
    })

    it('simplifies to true when arguments are missing entirely', () => {
      const ARGS1 = { where: { id: 1 } }
      const ARGS2 = { take: 20 }

      const before = {
        arguments: ARGS1,
        selection: {
          name: true,
          posts: {
            arguments: ARGS2,
            selection: {
              $scalars: true,
              $composites: true,
              comments: {
                selection: {
                  $scalars: true,
                  $composites: true,
                },
              },
            },
          },
        },
      }

      const after = {
        ...ARGS1,
        select: {
          name: true,
          posts: {
            ...ARGS2,
            include: {
              comments: true,
            },
          },
        },
      }

      expect(shapeQuery(before)).toEqual(after)
    })
  })

  describe('example 8: all include chain with simplification', () => {
    it('uses include at all levels when all have $scalars', () => {
      const ARGS1 = { where: { email: 'test@example.com' } }
      const ARGS2 = { orderBy: { title: 'asc' } }

      const before = {
        arguments: ARGS1,
        selection: {
          $scalars: true,
          $composites: true,
          posts: {
            arguments: ARGS2,
            selection: {
              $scalars: true,
              $composites: true,
              comments: {
                arguments: {},
                selection: {
                  $scalars: true,
                  $composites: true,
                },
              },
            },
          },
        },
      }

      const after = {
        ...ARGS1,
        include: {
          posts: {
            ...ARGS2,
            include: {
              comments: true,
            },
          },
        },
      }

      expect(shapeQuery(before)).toEqual(after)
    })
  })

  describe('example 9: include with nested select', () => {
    it('uses include at top, select for relation without $scalars', () => {
      const ARGS1 = { where: { id: 1 } }
      const ARGS2 = { take: 5 }

      const before = {
        arguments: ARGS1,
        selection: {
          $scalars: true,
          $composites: true,
          posts: {
            arguments: ARGS2,
            selection: {
              title: true,
              comments: {
                arguments: {},
                selection: {
                  $scalars: true,
                  $composites: true,
                },
              },
            },
          },
        },
      }

      const after = {
        ...ARGS1,
        include: {
          posts: {
            ...ARGS2,
            select: {
              title: true,
              comments: true,
            },
          },
        },
      }

      expect(shapeQuery(before)).toEqual(after)
    })
  })

  describe('deeply nested chains', () => {
    it('handles 4 levels of nesting with mixed select/include', () => {
      const before = {
        arguments: { where: { id: 1 } },
        selection: {
          name: true,
          posts: {
            arguments: { take: 10 },
            selection: {
              $scalars: true,
              $composites: true,
              comments: {
                arguments: { orderBy: { id: 'desc' } },
                selection: {
                  text: true,
                  author: {
                    arguments: {},
                    selection: {
                      $scalars: true,
                      $composites: true,
                    },
                  },
                },
              },
            },
          },
        },
      }

      const after = {
        where: { id: 1 },
        select: {
          name: true,
          posts: {
            take: 10,
            include: {
              comments: {
                orderBy: { id: 'desc' },
                select: {
                  text: true,
                  author: true,
                },
              },
            },
          },
        },
      }

      expect(shapeQuery(before)).toEqual(after)
    })

    it('handles all include chain with non-empty arguments at each level', () => {
      const before = {
        arguments: { where: { active: true } },
        selection: {
          $scalars: true,
          $composites: true,
          posts: {
            arguments: { take: 5 },
            selection: {
              $scalars: true,
              $composites: true,
              comments: {
                arguments: { skip: 2 },
                selection: {
                  $scalars: true,
                  $composites: true,
                  author: {
                    arguments: { select: { name: true } },
                    selection: {
                      $scalars: true,
                      $composites: true,
                    },
                  },
                },
              },
            },
          },
        },
      }

      const after = {
        where: { active: true },
        include: {
          posts: {
            take: 5,
            include: {
              comments: {
                skip: 2,
                include: {
                  author: {
                    select: { name: true },
                  },
                },
              },
            },
          },
        },
      }

      expect(shapeQuery(before)).toEqual(after)
    })
  })

  describe('multiple relations at the same level', () => {
    it('handles multiple nested relations with different structures', () => {
      const before = {
        arguments: { where: { id: 1 } },
        selection: {
          $scalars: true,
          $composites: true,
          posts: {
            arguments: { take: 10 },
            selection: {
              $scalars: true,
              $composites: true,
            },
          },
          profile: {
            arguments: {},
            selection: {
              $scalars: true,
              $composites: true,
            },
          },
          comments: {
            arguments: {},
            selection: {
              text: true,
            },
          },
        },
      }

      const after = {
        where: { id: 1 },
        include: {
          posts: {
            take: 10,
          },
          profile: true,
          comments: {
            select: {
              text: true,
            },
          },
        },
      }

      expect(shapeQuery(before)).toEqual(after)
    })

    it('handles sibling relations in select mode', () => {
      const before = {
        arguments: {},
        selection: {
          name: true,
          posts: {
            arguments: {},
            selection: {
              title: true,
            },
          },
          comments: {
            arguments: {},
            selection: {
              $scalars: true,
              $composites: true,
            },
          },
        },
      }

      const after = {
        select: {
          name: true,
          posts: {
            select: {
              title: true,
            },
          },
          comments: true,
        },
      }

      expect(shapeQuery(before)).toEqual(after)
    })
  })
})
