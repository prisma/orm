import { describe, expect, it } from 'vitest';
import { duplicateStoredMembers } from '../src/shared/enum-stored-members';

describe('duplicateStoredMembers', () => {
  it('finds no duplicate among members stored differently', () => {
    expect(
      duplicateStoredMembers([
        { name: 'Square', stored: { sides: 4 } },
        { name: 'Triangle', stored: { sides: 3 } },
        { name: 'Pair', stored: [1, 2] },
        { name: 'Triple', stored: [1, 2, 3] },
        { name: 'One', stored: 1 },
        { name: 'OneText', stored: '1' },
      ]),
    ).toEqual([]);
  });

  it('pairs each member with the earlier member stored the same, comparing objects by their entries', () => {
    expect(
      duplicateStoredMembers([
        { name: 'Wide', stored: { width: 2, height: 1 } },
        { name: 'Active', stored: 'active' },
        { name: 'AlsoWide', stored: { height: 1, width: 2 } },
        { name: 'StillActive', stored: 'active' },
        { name: 'WideAgain', stored: { width: 2, height: 1 } },
      ]),
    ).toEqual([
      { earlier: 'Wide', later: 'AlsoWide', stored: { height: 1, width: 2 } },
      { earlier: 'Active', later: 'StillActive', stored: 'active' },
      { earlier: 'Wide', later: 'WideAgain', stored: { width: 2, height: 1 } },
    ]);
  });

  it('treats negative zero as zero, as contract.json writes it', () => {
    expect(
      duplicateStoredMembers([
        { name: 'Zero', stored: 0 },
        { name: 'NegativeZero', stored: -0 },
        { name: 'Origin', stored: { x: 0 } },
        { name: 'NegativeOrigin', stored: { x: -0 } },
      ]),
    ).toEqual([
      { earlier: 'Zero', later: 'NegativeZero', stored: -0 },
      { earlier: 'Origin', later: 'NegativeOrigin', stored: { x: -0 } },
    ]);
  });
});
