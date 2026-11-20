import { describe, expect, it } from 'vitest'

import { shapeQuery } from '../shape'

describe('shapeQuery - basic transformations', () => {
  describe('example 1: scalars only, no relations', () => {
    it('returns just the arguments when selection is only $scalars and $composites', () => {
      const before = {
        arguments: { where: { id: 1 } },
        selection: {
          $scalars: true,
          $composites: true,
        },
      }

      const after = {
        where: { id: 1 },
      }

      expect(shapeQuery(before)).toEqual(after)
    })

    it('handles empty arguments', () => {
      const before = {
        arguments: {},
        selection: {
          $scalars: true,
          $composites: true,
        },
      }

      expect(shapeQuery(before)).toEqual({})
    })

    it('handles missing arguments', () => {
      const before = {
        selection: {
          $scalars: true,
          $composites: true,
        },
      }

      expect(shapeQuery(before)).toEqual({})
    })
  })

  describe('example 2: scalars with simple relation', () => {
    it('uses include with true for relation when parent has $scalars', () => {
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

      const after = {
        where: { id: 1 },
        include: {
          posts: true,
        },
      }

      expect(shapeQuery(before)).toEqual(after)
    })

    it('handles multiple simple relations', () => {
      const before = {
        arguments: { take: 10 },
        selection: {
          $scalars: true,
          $composites: true,
          posts: {
            $scalars: true,
            $composites: true,
          },
          profile: {
            $scalars: true,
            $composites: true,
          },
        },
      }

      const after = {
        take: 10,
        include: {
          posts: true,
          profile: true,
        },
      }

      expect(shapeQuery(before)).toEqual(after)
    })
  })

  describe('example 3: scalars with relation having explicit field selection', () => {
    it('uses include with select for relation when relation selects specific fields', () => {
      const before = {
        arguments: { where: { id: 1 } },
        selection: {
          $scalars: true,
          $composites: true,
          posts: {
            arguments: {},
            selection: {
              title: true,
            },
          },
        },
      }

      const after = {
        where: { id: 1 },
        include: {
          posts: {
            select: {
              title: true,
            },
          },
        },
      }

      expect(shapeQuery(before)).toEqual(after)
    })
  })

  describe('example 4: explicit field selection without $scalars', () => {
    it('uses select for both fields and relations when no $scalars', () => {
      const before = {
        arguments: { where: { active: true } },
        selection: {
          name: true,
          posts: {
            arguments: {},
            selection: {
              title: true,
            },
          },
        },
      }

      const after = {
        where: { active: true },
        select: {
          name: true,
          posts: {
            select: {
              title: true,
            },
          },
        },
      }

      expect(shapeQuery(before)).toEqual(after)
    })
  })

  describe('example 5: explicit selection with boolean relation', () => {
    it('keeps boolean relation as true in select', () => {
      const before = {
        arguments: { skip: 5 },
        selection: {
          name: true,
          posts: true,
        },
      }

      const after = {
        skip: 5,
        select: {
          name: true,
          posts: true,
        },
      }

      expect(shapeQuery(before)).toEqual(after)
    })
  })

  describe('preserving false in selections', () => {
    it('preserves false values in field selection', () => {
      const before = {
        arguments: {},
        selection: {
          name: true,
          email: false,
          password: false,
        },
      }

      const after = {
        select: {
          name: true,
          email: false,
          password: false,
        },
      }

      expect(shapeQuery(before)).toEqual(after)
    })
  })
})
