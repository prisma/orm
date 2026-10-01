import { describe, expect, it } from 'vitest';
import { junctionRelationFieldNames } from '../../src/core/psl-infer/junction-relation-field-names';

describe('junctionRelationFieldNames', () => {
  it('names each foreign key after the table it references', () => {
    expect(junctionRelationFieldNames('blog_posts', 'Tag')).toEqual(['blogPosts', 'tag']);
  });

  it('gives a self relation the referenced model name on the second name', () => {
    expect(junctionRelationFieldNames('User', 'User')).toEqual(['user', 'userUser']);
  });

  it('moves a name off the fields columns A and B print as', () => {
    expect(junctionRelationFieldNames('A', 'B')).toEqual(['a2', 'b2']);
    expect(junctionRelationFieldNames('A', 'A')).toEqual(['a2', 'aA']);
    expect(junctionRelationFieldNames('b', 'a')).toEqual(['b2', 'a2']);
    expect(junctionRelationFieldNames('A', 'A2')).toEqual(['a2', 'a22']);
  });

  it('escapes PSL reserved words and leading digits as infer does', () => {
    expect(junctionRelationFieldNames('Type', 'Type')).toEqual(['_type', '_type_Type']);
    expect(junctionRelationFieldNames('3d_items', '3d_items')).toEqual([
      '_3dItems',
      '_3dItems_3dItems',
    ]);
    expect(junctionRelationFieldNames('Group', 'Order')).toEqual(['group', 'order']);
  });
});
