import { describe, expect, it } from 'vitest'

import { shapeQuery } from '../shape'

describe('shapeQuery - edge cases', () => {
  describe('null and undefined handling', () => {
    it('returns null for null input', () => {
      expect(shapeQuery(null)).toBeNull()
    })

    it('returns undefined for undefined input', () => {
      expect(shapeQuery(undefined)).toBeUndefined()
    })

    it('returns primitives as-is', () => {
      expect(shapeQuery('string')).toBe('string')
      expect(shapeQuery(123)).toBe(123)
      expect(shapeQuery(true)).toBe(true)
    })
  })

  describe('empty objects', () => {
    it('handles completely empty query', () => {
      expect(shapeQuery({})).toEqual({})
    })

    it('handles query with only empty arguments', () => {
      const before = {
        arguments: {},
      }

      expect(shapeQuery(before)).toEqual({})
    })

    it('handles query with only empty selection', () => {
      const before = {
        selection: {},
      }

      expect(shapeQuery(before)).toEqual({})
    })

    it('handles empty selection with only $composites (no $scalars)', () => {
      const before = {
        arguments: { where: { id: 1 } },
        selection: {
          $composites: true,
        },
      }

      // No $scalars means no fields selected, should result in just arguments
      expect(shapeQuery(before)).toEqual({ where: { id: 1 } })
    })
  })

  describe('$scalars without $composites', () => {
    it('handles $scalars: true without $composites', () => {
      const before = {
        arguments: { take: 5 },
        selection: {
          $scalars: true,
        },
      }

      expect(shapeQuery(before)).toEqual({ take: 5 })
    })

    it('handles $scalars: false', () => {
      const before = {
        arguments: { where: { id: 1 } },
        selection: {
          $scalars: false,
          $composites: true,
        },
      }

      // $scalars: false is not true, so no special handling
      expect(shapeQuery(before)).toEqual({ where: { id: 1 } })
    })
  })

  describe('only $composites ignored', () => {
    it('ignores $composites in selection processing', () => {
      const before = {
        arguments: { where: { id: 1 } },
        selection: {
          $scalars: true,
          $composites: true,
          posts: {
            $scalars: true,
            $composites: true,
          },
        },
      }

      // $composites should not affect output
      const after = {
        where: { id: 1 },
        include: {
          posts: true,
        },
      }

      expect(shapeQuery(before)).toEqual(after)
    })
  })

  describe('selection with only relations', () => {
    it('handles selection with only object relations (no booleans, no $scalars)', () => {
      const before = {
        arguments: { where: { id: 1 } },
        selection: {
          posts: {
            arguments: {},
            selection: {
              $scalars: true,
              $composites: true,
            },
          },
        },
      }

      // No $scalars at top level, so use select
      const after = {
        where: { id: 1 },
        select: {
          posts: true,
        },
      }

      expect(shapeQuery(before)).toEqual(after)
    })
  })

  describe('complex argument structures', () => {
    it('preserves nested argument structures', () => {
      const before = {
        arguments: {
          where: {
            AND: [{ email: { contains: 'test' } }, { age: { gte: 18 } }],
          },
          orderBy: [{ createdAt: 'desc' }, { name: 'asc' }],
          take: 10,
          skip: 5,
        },
        selection: {
          $scalars: true,
          $composites: true,
        },
      }

      const after = {
        where: {
          AND: [{ email: { contains: 'test' } }, { age: { gte: 18 } }],
        },
        orderBy: [{ createdAt: 'desc' }, { name: 'asc' }],
        take: 10,
        skip: 5,
      }

      expect(shapeQuery(before)).toEqual(after)
    })

    it('preserves deeply nested data in arguments', () => {
      const before = {
        arguments: {
          data: {
            user: {
              create: {
                profile: {
                  create: {
                    bio: 'Hello',
                  },
                },
              },
            },
          },
        },
        selection: {
          $scalars: true,
          $composites: true,
        },
      }

      const after = {
        data: {
          user: {
            create: {
              profile: {
                create: {
                  bio: 'Hello',
                },
              },
            },
          },
        },
      }

      expect(shapeQuery(before)).toEqual(after)
    })
  })

  describe('relation with arguments but no selection', () => {
    it('handles relation with only arguments', () => {
      const before = {
        arguments: { where: { id: 1 } },
        selection: {
          $scalars: true,
          $composites: true,
          posts: {
            arguments: { take: 10 },
          },
        },
      }

      const after = {
        where: { id: 1 },
        include: {
          posts: {
            take: 10,
          },
        },
      }

      expect(shapeQuery(before)).toEqual(after)
    })
  })

  describe('relation with only selection', () => {
    it('handles relation with only selection (no arguments key)', () => {
      const before = {
        arguments: { where: { active: true } },
        selection: {
          $scalars: true,
          $composites: true,
          posts: {
            selection: {
              $scalars: true,
              $composites: true,
            },
          },
        },
      }

      // No arguments means it can be simplified to true
      const after = {
        where: { active: true },
        include: {
          posts: true,
        },
      }

      expect(shapeQuery(before)).toEqual(after)
    })
  })

  describe('mixed boolean and object fields without $scalars', () => {
    it('combines boolean fields and shaped relations in select', () => {
      const before = {
        arguments: {},
        selection: {
          id: true,
          name: true,
          email: false,
          posts: {
            arguments: { take: 5 },
            selection: {
              title: true,
              body: true,
            },
          },
          profile: true,
        },
      }

      const after = {
        select: {
          id: true,
          name: true,
          email: false,
          posts: {
            take: 5,
            select: {
              title: true,
              body: true,
            },
          },
          profile: true,
        },
      }

      expect(shapeQuery(before)).toEqual(after)
    })
  })

  describe('selection markers alongside explicit fields', () => {
    it('$scalars overrides the explicit fields', () => {
      const before = {
        arguments: {},
        selection: {
          $scalars: true,
          name: true,
          email: true,
        },
      }

      const after = {}

      expect(shapeQuery(before)).toEqual(after)
    })
  })

  describe('arrays as field values', () => {
    it('preserves arrays in arguments', () => {
      const before = {
        arguments: {
          where: {
            id: { in: [1, 2, 3] },
          },
        },
        selection: {
          $scalars: true,
          $composites: true,
        },
      }

      const after = {
        where: {
          id: { in: [1, 2, 3] },
        },
      }

      expect(shapeQuery(before)).toEqual(after)
    })
  })

  describe('special characters in keys', () => {
    it('handles field names with underscores', () => {
      const before = {
        arguments: {},
        selection: {
          first_name: true,
          last_name: true,
          _count: true,
        },
      }

      const after = {
        select: {
          first_name: true,
          last_name: true,
          _count: true,
        },
      }

      expect(shapeQuery(before)).toEqual(after)
    })
  })

  describe('relation simplification edge cases', () => {
    it('does not simplify when selection has extra fields beyond $scalars/$composites', () => {
      const before = {
        arguments: {},
        selection: {
          $scalars: true,
          $composites: true,
          posts: {
            arguments: {},
            selection: {
              $scalars: true,
              $composites: true,
              comments: {
                $scalars: true,
                $composites: true,
              },
            },
          },
        },
      }

      // posts has nested comments, so it can't simplify to true
      const after = {
        include: {
          posts: {
            include: {
              comments: true,
            },
          },
        },
      }

      expect(shapeQuery(before)).toEqual(after)
    })

    it('simplifies relation when only $scalars is present (no $composites)', () => {
      const before = {
        arguments: { where: { id: 1 } },
        selection: {
          $scalars: true,
          $composites: true,
          posts: {
            arguments: {},
            selection: {
              $scalars: true,
            },
          },
        },
      }

      const after = {
        where: { id: 1 },
        include: {
          posts: true,
        },
      }

      expect(shapeQuery(before)).toEqual(after)
    })
  })
})
