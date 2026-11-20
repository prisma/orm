import { Writer } from '@prisma/ts-builders'
import ansiEscapesSerializer from 'jest-serializer-ansi-escapes'
import { $ as colors } from 'kleur/colors'
import { describe, expect, type SnapshotSerializer, test } from 'vitest'

import { GlobalOmitOptions } from '../jsonProtocol/serializeJsonQuery'
import { JsArgs } from '../types/exported/JsApi'
import { ValidationError } from '../types/ValidationError'
import { applyValidationError } from './applyValidationError'
import { ArgumentsRenderingTree, buildArgumentsRenderingTree } from './ArgumentsRenderingTree'
import { activeColors, inactiveColors } from './base'

expect.addSnapshotSerializer(ansiEscapesSerializer as unknown as SnapshotSerializer)

const renderError = (error: ValidationError, args: JsArgs, globalOmit: GlobalOmitOptions = {}) => {
  const argsTree = buildArgumentsRenderingTree(args)
  applyValidationError(error, argsTree, globalOmit)

  return `
Colorless:

${renderTreeWithChalkLevel(argsTree, false)}

------------------------------------

Colored:

${renderTreeWithChalkLevel(argsTree, true)}
`
}

function renderTreeWithChalkLevel(argsTree: ArgumentsRenderingTree, colorsEnabled: boolean) {
  colors.enabled = colorsEnabled
  const context = { colors: colorsEnabled ? activeColors : inactiveColors }
  const argsStr = new Writer(0, context).write(argsTree).toString()
  const message = argsTree.renderAllMessages(context.colors)

  return `${argsStr}\n\n${message}`
}

const PostOutputDescription = {
  name: 'Post',
  fields: [
    { name: 'id', typeName: 'string', isRelation: false },
    { name: 'title', typeName: 'string', isRelation: false },
    { name: 'comments', typeName: 'Comment', isRelation: true },
  ],
}

describe('mutuallyExclusiveFields', () => {
  test('top level', () => {
    expect(
      renderError(
        { kind: 'MutuallyExclusiveFields', firstField: 'include', secondField: 'select', selectionPath: [] },
        {
          data: { foo: 'bar' },
          include: {},
          select: {},
        },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        data: {
          foo: "bar"
        },
        include: {},
        ~~~~~~~
        select: {}
        ~~~~~~
      }

      Please either use \`include\` or \`select\`, but not both at the same time.

      ------------------------------------

      Colored:

      {
        data: {
          foo: "bar"
        },
        <red>include</color>: {},
        <red>~~~~~~~</color>
        <red>select</color>: {}
        <red>~~~~~~</color>
      }

      Please <bold>either</intensity> use <green>\`include\`</color> or <green>\`select\`</color>, but <red>not both</color> at the same time.
      "
    `)
  })

  test('top level (omit)', () => {
    expect(
      renderError(
        { kind: 'MutuallyExclusiveFields', firstField: 'omit', secondField: 'select', selectionPath: [] },
        {
          data: { foo: 'bar' },
          omit: {},
          select: {},
        },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        data: {
          foo: "bar"
        },
        omit: {},
        ~~~~
        select: {}
        ~~~~~~
      }

      Please either use \`omit\` or \`select\`, but not both at the same time.

      ------------------------------------

      Colored:

      {
        data: {
          foo: "bar"
        },
        <red>omit</color>: {},
        <red>~~~~</color>
        <red>select</color>: {}
        <red>~~~~~~</color>
      }

      Please <bold>either</intensity> use <green>\`omit\`</color> or <green>\`select\`</color>, but <red>not both</color> at the same time.
      "
    `)
  })

  test('deep', () => {
    expect(
      renderError(
        {
          kind: 'MutuallyExclusiveFields',
          firstField: 'include',
          secondField: 'select',
          selectionPath: ['posts', 'likes'],
        },
        {
          include: {
            posts: {
              where: { published: true },
              select: {
                likes: {
                  select: {},
                  include: {},
                },
              },
            },
          },
        },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        include: {
          posts: {
            where: {
              published: true
            },
            select: {
              likes: {
                select: {},
                ~~~~~~
                include: {}
                ~~~~~~~
              }
            }
          }
        }
      }

      Please either use \`include\` or \`select\`, but not both at the same time.

      ------------------------------------

      Colored:

      {
        include: {
          posts: {
            where: {
              published: true
            },
            select: {
              likes: {
                <red>select</color>: {},
                <red>~~~~~~</color>
                <red>include</color>: {}
                <red>~~~~~~~</color>
              }
            }
          }
        }
      }

      Please <bold>either</intensity> use <green>\`include\`</color> or <green>\`select\`</color>, but <red>not both</color> at the same time.
      "
    `)
  })
})

describe('includeOnScalar', () => {
  test('top level - no type description', () => {
    expect(
      renderError(
        { kind: 'IncludeOnScalar', selectionPath: ['id'] },
        {
          data: { foo: 'bar' },
          include: {
            id: true,
          },
        },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        data: {
          foo: "bar"
        },
        include: {
          id: true
          ~~
        }
      }

      Invalid scalar field \`id\` for include statement.
      Note that include statements only accept relation fields.

      ------------------------------------

      Colored:

      {
        data: {
          foo: "bar"
        },
        include: {
          <red>id</color>: true
          <red>~~</color>
        }
      }

      Invalid scalar field <red>\`id\`</color> for <bold>include</intensity> statement.
      Note that <bold>include</intensity> statements only accept relation fields.
      "
    `)
  })

  test('top level - with type descriptions', () => {
    expect(
      renderError(
        {
          kind: 'IncludeOnScalar',
          selectionPath: ['id'],
          outputType: {
            name: 'User',
            fields: [
              { name: 'id', typeName: 'Int', isRelation: false },
              { name: 'name', typeName: 'String', isRelation: false },
              { name: 'posts', typeName: 'Post', isRelation: true },
            ],
          },
        },
        {
          data: { foo: 'bar' },
          include: {
            id: true,
          },
        },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        data: {
          foo: "bar"
        },
        include: {
          id: true,
          ~~
      ?   posts?: true
        }
      }

      Invalid scalar field \`id\` for include statement on model User. Available options are marked with ?.
      Note that include statements only accept relation fields.

      ------------------------------------

      Colored:

      {
        data: {
          foo: "bar"
        },
        include: {
          <red>id</color>: true,
          <red>~~</color>
      <green>?</color>   <green>posts</color><green>?</color><green>: </color><green>true</color>
        }
      }

      Invalid scalar field <red>\`id\`</color> for <bold>include</intensity> statement on model <bold>User</intensity>. Available options are listed in <green>green</color>.
      Note that <bold>include</intensity> statements only accept relation fields.
      "
    `)
  })

  test('nested - no type description', () => {
    expect(
      renderError(
        { kind: 'IncludeOnScalar', selectionPath: ['posts', 'id'] },
        {
          data: { foo: 'bar' },
          include: {
            posts: {
              include: {
                id: true,
              },
            },
          },
        },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        data: {
          foo: "bar"
        },
        include: {
          posts: {
            include: {
              id: true
              ~~
            }
          }
        }
      }

      Invalid scalar field \`id\` for include statement.
      Note that include statements only accept relation fields.

      ------------------------------------

      Colored:

      {
        data: {
          foo: "bar"
        },
        include: {
          posts: {
            include: {
              <red>id</color>: true
              <red>~~</color>
            }
          }
        }
      }

      Invalid scalar field <red>\`id\`</color> for <bold>include</intensity> statement.
      Note that <bold>include</intensity> statements only accept relation fields.
      "
    `)
  })

  test('nested - with type descriptions', () => {
    expect(
      renderError(
        {
          kind: 'IncludeOnScalar',
          selectionPath: ['posts', 'id'],
          outputType: {
            name: 'Post',
            fields: [
              { name: 'id', typeName: 'Int', isRelation: false },
              { name: 'title', typeName: 'String', isRelation: false },
              { name: 'likes', typeName: 'Like', isRelation: true },
            ],
          },
        },
        {
          data: { foo: 'bar' },
          include: {
            posts: {
              include: {
                id: true,
              },
            },
          },
        },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        data: {
          foo: "bar"
        },
        include: {
          posts: {
            include: {
              id: true,
              ~~
      ?       likes?: true
            }
          }
        }
      }

      Invalid scalar field \`id\` for include statement on model Post. Available options are marked with ?.
      Note that include statements only accept relation fields.

      ------------------------------------

      Colored:

      {
        data: {
          foo: "bar"
        },
        include: {
          posts: {
            include: {
              <red>id</color>: true,
              <red>~~</color>
      <green>?</color>       <green>likes</color><green>?</color><green>: </color><green>true</color>
            }
          }
        }
      }

      Invalid scalar field <red>\`id\`</color> for <bold>include</intensity> statement on model <bold>Post</intensity>. Available options are listed in <green>green</color>.
      Note that <bold>include</intensity> statements only accept relation fields.
      "
    `)
  })
})

describe('EmptySelection', () => {
  test('top level', () => {
    expect(
      renderError(
        {
          kind: 'EmptySelection',
          selectionPath: [],
          outputType: PostOutputDescription,
        },
        { where: { published: true }, select: {} },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        where: {
          published: true
        },
        select: {
      ?   id?: true,
      ?   title?: true,
      ?   comments?: true
        }
      }

      The \`select\` statement for type Post must not be empty. Available options are marked with ?.

      ------------------------------------

      Colored:

      {
        where: {
          published: true
        },
        select: {
      <green>?</color>   <green>id</color><green>?</color><green>: </color><green>true</color>,
      <green>?</color>   <green>title</color><green>?</color><green>: </color><green>true</color>,
      <green>?</color>   <green>comments</color><green>?</color><green>: </color><green>true</color>
        }
      }

      The <red>\`select\`</color> statement for type <bold>Post</intensity> must not be empty. Available options are listed in <green>green</color>.
      "
    `)
  })

  test('top level (omit)', () => {
    expect(
      renderError(
        {
          kind: 'EmptySelection',
          selectionPath: [],
          outputType: PostOutputDescription,
        },
        { where: { published: true }, omit: { id: true, title: true } },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        where: {
          published: true
        },
        omit: {
      ?   id?: false,
      ?   title?: false,
      ?   comments?: false
        }
      }

      The omit statement includes every field of the model Post. At least one field must be included in the result

      ------------------------------------

      Colored:

      {
        where: {
          published: true
        },
        omit: {
      <green>?</color>   <green>id</color><green>?</color><green>: </color><green>false</color>,
      <green>?</color>   <green>title</color><green>?</color><green>: </color><green>false</color>,
      <green>?</color>   <green>comments</color><green>?</color><green>: </color><green>false</color>
        }
      }

      The <red>omit</color> statement includes every field of the model <bold>Post</intensity>. At least one field must be included in the result
      "
    `)
  })

  test('top level (global omit)', () => {
    expect(
      renderError(
        {
          kind: 'EmptySelection',
          selectionPath: [],
          outputType: PostOutputDescription,
        },
        { where: { published: true } },
        { post: { id: true, title: true } },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        where: {
          published: true
        },
      + omit: {
      +   id: false,
      +   title: false
      + }
      }

      The global omit configuration excludes every field of the model Post. At least one field must be included in the result

      ------------------------------------

      Colored:

      {
        where: {
          published: true
        },
      <green>+</color> <green>omit</color><green>: </color><green>{</color>
      <green><dim>+</intensity></color>   <green><dim>id: false</intensity></color>,
      <green><dim>+</intensity></color>   <green><dim>title: false</intensity></color>
      <green>+</color> <green>}</color>
      }

      The global <red>omit</color> configuration excludes every field of the model <bold>Post</intensity>. At least one field must be included in the result
      "
    `)
  })

  test('top level with falsy values', () => {
    expect(
      renderError(
        {
          kind: 'EmptySelection',
          selectionPath: [],
          outputType: PostOutputDescription,
        },
        { where: { published: true }, select: { id: false } },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        where: {
          published: true
        },
        select: {
      ?   id?: true,
      ?   title?: true,
      ?   comments?: true
        }
      }

      The \`select\` statement for type Post needs at least one truthy value.

      ------------------------------------

      Colored:

      {
        where: {
          published: true
        },
        select: {
      <green>?</color>   <green>id</color><green>?</color><green>: </color><green>true</color>,
      <green>?</color>   <green>title</color><green>?</color><green>: </color><green>true</color>,
      <green>?</color>   <green>comments</color><green>?</color><green>: </color><green>true</color>
        }
      }

      The <red>\`select\`</color> statement for type <bold>Post</intensity> needs <bold>at least one truthy value</intensity>.
      "
    `)
  })

  test('nested', () => {
    expect(
      renderError(
        {
          kind: 'EmptySelection',
          selectionPath: ['users', 'posts'],
          outputType: PostOutputDescription,
        },
        { select: { users: { include: { posts: { select: {} } } } } },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        select: {
          users: {
            include: {
              posts: {
                select: {
      ?           id?: true,
      ?           title?: true,
      ?           comments?: true
                }
              }
            }
          }
        }
      }

      The \`select\` statement for type Post must not be empty. Available options are marked with ?.

      ------------------------------------

      Colored:

      {
        select: {
          users: {
            include: {
              posts: {
                select: {
      <green>?</color>           <green>id</color><green>?</color><green>: </color><green>true</color>,
      <green>?</color>           <green>title</color><green>?</color><green>: </color><green>true</color>,
      <green>?</color>           <green>comments</color><green>?</color><green>: </color><green>true</color>
                }
              }
            }
          }
        }
      }

      The <red>\`select\`</color> statement for type <bold>Post</intensity> must not be empty. Available options are listed in <green>green</color>.
      "
    `)
  })

  test('nested (omit)', () => {
    expect(
      renderError(
        {
          kind: 'EmptySelection',
          selectionPath: ['users', 'posts'],
          outputType: PostOutputDescription,
        },
        { select: { users: { include: { posts: { omit: { id: true, title: true, comments: true } } } } } },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        select: {
          users: {
            include: {
              posts: {
                omit: {
      ?           id?: false,
      ?           title?: false,
      ?           comments?: false
                }
              }
            }
          }
        }
      }

      The omit statement includes every field of the model Post. At least one field must be included in the result

      ------------------------------------

      Colored:

      {
        select: {
          users: {
            include: {
              posts: {
                omit: {
      <green>?</color>           <green>id</color><green>?</color><green>: </color><green>false</color>,
      <green>?</color>           <green>title</color><green>?</color><green>: </color><green>false</color>,
      <green>?</color>           <green>comments</color><green>?</color><green>: </color><green>false</color>
                }
              }
            }
          }
        }
      }

      The <red>omit</color> statement includes every field of the model <bold>Post</intensity>. At least one field must be included in the result
      "
    `)
  })

  test('nested (globalOmit)', () => {
    expect(
      renderError(
        {
          kind: 'EmptySelection',
          selectionPath: ['users', 'posts'],
          outputType: PostOutputDescription,
        },
        { select: { users: { include: { posts: true } } } },
        { post: { id: true, title: true, comments: true } },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        select: {
          users: {
            include: {
              posts: {
      +         omit: {
      +           id: false,
      +           title: false
      +         }
              }
            }
          }
        }
      }

      The global omit configuration excludes every field of the model Post. At least one field must be included in the result

      ------------------------------------

      Colored:

      {
        select: {
          users: {
            include: {
              posts: {
      <green>+</color>         <green>omit</color><green>: </color><green>{</color>
      <green><dim>+</intensity></color>           <green><dim>id: false</intensity></color>,
      <green><dim>+</intensity></color>           <green><dim>title: false</intensity></color>
      <green>+</color>         <green>}</color>
              }
            }
          }
        }
      }

      The global <red>omit</color> configuration excludes every field of the model <bold>Post</intensity>. At least one field must be included in the result
      "
    `)
  })
})

describe('UnknownSelectionField', () => {
  test('top level select', () => {
    expect(
      renderError(
        {
          kind: 'UnknownSelectionField',
          selectionPath: ['notThere'],
          outputType: PostOutputDescription,
        },
        { select: { notThere: true } },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        select: {
          notThere: true,
          ~~~~~~~~
      ?   id?: true,
      ?   title?: true,
      ?   comments?: true
        }
      }

      Unknown field \`notThere\` for select statement on model \`Post\`. Available options are marked with ?.

      ------------------------------------

      Colored:

      {
        select: {
          <red>notThere</color>: true,
          <red>~~~~~~~~</color>
      <green>?</color>   <green>id</color><green>?</color><green>: </color><green>true</color>,
      <green>?</color>   <green>title</color><green>?</color><green>: </color><green>true</color>,
      <green>?</color>   <green>comments</color><green>?</color><green>: </color><green>true</color>
        }
      }

      Unknown field <red>\`notThere\`</color> for <bold>select</intensity> statement on model <bold>\`Post\`</intensity>. Available options are listed in <green>green</color>.
      "
    `)
  })

  test('top level include', () => {
    expect(
      renderError(
        {
          kind: 'UnknownSelectionField',
          selectionPath: ['notThere'],
          outputType: PostOutputDescription,
        },
        { include: { notThere: true } },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        include: {
          notThere: true,
          ~~~~~~~~
      ?   comments?: true
        }
      }

      Unknown field \`notThere\` for include statement on model \`Post\`. Available options are marked with ?.

      ------------------------------------

      Colored:

      {
        include: {
          <red>notThere</color>: true,
          <red>~~~~~~~~</color>
      <green>?</color>   <green>comments</color><green>?</color><green>: </color><green>true</color>
        }
      }

      Unknown field <red>\`notThere\`</color> for <bold>include</intensity> statement on model <bold>\`Post\`</intensity>. Available options are listed in <green>green</color>.
      "
    `)
  })

  test('top level omit', () => {
    expect(
      renderError(
        {
          kind: 'UnknownSelectionField',
          selectionPath: ['notThere'],
          outputType: PostOutputDescription,
        },
        { omit: { notThere: true } },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        omit: {
          notThere: true,
          ~~~~~~~~
      ?   id?: true,
      ?   title?: true
        }
      }

      Unknown field \`notThere\` for omit statement on model \`Post\`. Available options are marked with ?.

      ------------------------------------

      Colored:

      {
        omit: {
          <red>notThere</color>: true,
          <red>~~~~~~~~</color>
      <green>?</color>   <green>id</color><green>?</color><green>: </color><green>true</color>,
      <green>?</color>   <green>title</color><green>?</color><green>: </color><green>true</color>
        }
      }

      Unknown field <red>\`notThere\`</color> for <bold>omit</intensity> statement on model <bold>\`Post\`</intensity>. Available options are listed in <green>green</color>.
      "
    `)
  })

  test('nested select', () => {
    expect(
      renderError(
        {
          kind: 'UnknownSelectionField',
          selectionPath: ['users', 'posts', 'notThere'],
          outputType: PostOutputDescription,
        },
        { select: { users: { select: { posts: { select: { notThere: true } } } } } },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        select: {
          users: {
            select: {
              posts: {
                select: {
                  notThere: true,
                  ~~~~~~~~
      ?           id?: true,
      ?           title?: true,
      ?           comments?: true
                }
              }
            }
          }
        }
      }

      Unknown field \`notThere\` for select statement on model \`Post\`. Available options are marked with ?.

      ------------------------------------

      Colored:

      {
        select: {
          users: {
            select: {
              posts: {
                select: {
                  <red>notThere</color>: true,
                  <red>~~~~~~~~</color>
      <green>?</color>           <green>id</color><green>?</color><green>: </color><green>true</color>,
      <green>?</color>           <green>title</color><green>?</color><green>: </color><green>true</color>,
      <green>?</color>           <green>comments</color><green>?</color><green>: </color><green>true</color>
                }
              }
            }
          }
        }
      }

      Unknown field <red>\`notThere\`</color> for <bold>select</intensity> statement on model <bold>\`Post\`</intensity>. Available options are listed in <green>green</color>.
      "
    `)
  })

  test('nested level include', () => {
    expect(
      renderError(
        {
          kind: 'UnknownSelectionField',
          selectionPath: ['users', 'posts', 'notThere'],
          outputType: PostOutputDescription,
        },
        { select: { users: { include: { posts: { include: { notThere: true } } } } } },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        select: {
          users: {
            include: {
              posts: {
                include: {
                  notThere: true,
                  ~~~~~~~~
      ?           comments?: true
                }
              }
            }
          }
        }
      }

      Unknown field \`notThere\` for include statement on model \`Post\`. Available options are marked with ?.

      ------------------------------------

      Colored:

      {
        select: {
          users: {
            include: {
              posts: {
                include: {
                  <red>notThere</color>: true,
                  <red>~~~~~~~~</color>
      <green>?</color>           <green>comments</color><green>?</color><green>: </color><green>true</color>
                }
              }
            }
          }
        }
      }

      Unknown field <red>\`notThere\`</color> for <bold>include</intensity> statement on model <bold>\`Post\`</intensity>. Available options are listed in <green>green</color>.
      "
    `)
  })

  test('nested level omit', () => {
    expect(
      renderError(
        {
          kind: 'UnknownSelectionField',
          selectionPath: ['users', 'posts', 'notThere'],
          outputType: PostOutputDescription,
        },
        { select: { users: { include: { posts: { omit: { notThere: true } } } } } },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        select: {
          users: {
            include: {
              posts: {
                omit: {
                  notThere: true,
                  ~~~~~~~~
      ?           id?: true,
      ?           title?: true
                }
              }
            }
          }
        }
      }

      Unknown field \`notThere\` for omit statement on model \`Post\`. Available options are marked with ?.

      ------------------------------------

      Colored:

      {
        select: {
          users: {
            include: {
              posts: {
                omit: {
                  <red>notThere</color>: true,
                  <red>~~~~~~~~</color>
      <green>?</color>           <green>id</color><green>?</color><green>: </color><green>true</color>,
      <green>?</color>           <green>title</color><green>?</color><green>: </color><green>true</color>
                }
              }
            }
          }
        }
      }

      Unknown field <red>\`notThere\`</color> for <bold>omit</intensity> statement on model <bold>\`Post\`</intensity>. Available options are listed in <green>green</color>.
      "
    `)
  })
})

describe('InvalidSelectionValue', () => {
  test('top level select', () => {
    expect(
      renderError(
        {
          kind: 'InvalidSelectionValue',
          selectionPath: ['name'],
          underlyingError: 'Not allowed',
        },
        {
          select: {
            // @ts-expect-error
            name: undefined,
          },
        },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        select: {
          name: undefined
                ~~~~~~~~~
        }
      }

      Invalid value for selection field \`name\`: Not allowed

      ------------------------------------

      Colored:

      {
        select: {
          name: <red>undefined</color>
                <red>~~~~~~~~~</color>
        }
      }

      Invalid value for selection field \`<red>name</color>\`: Not allowed
      "
    `)
  })

  test('top level include', () => {
    expect(
      renderError(
        {
          kind: 'InvalidSelectionValue',
          selectionPath: ['name'],
          underlyingError: 'Not allowed',
        },
        {
          include: {
            // @ts-expect-error
            name: undefined,
          },
        },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        include: {
          name: undefined
                ~~~~~~~~~
        }
      }

      Invalid value for selection field \`name\`: Not allowed

      ------------------------------------

      Colored:

      {
        include: {
          name: <red>undefined</color>
                <red>~~~~~~~~~</color>
        }
      }

      Invalid value for selection field \`<red>name</color>\`: Not allowed
      "
    `)
  })

  test('top level omit', () => {
    expect(
      renderError(
        {
          kind: 'InvalidSelectionValue',
          selectionPath: ['name'],
          underlyingError: 'Not allowed',
        },
        {
          omit: {
            // @ts-expect-error
            name: undefined,
          },
        },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        omit: {
          name: undefined
                ~~~~~~~~~
        }
      }

      Invalid value for selection field \`name\`: Not allowed

      ------------------------------------

      Colored:

      {
        omit: {
          name: <red>undefined</color>
                <red>~~~~~~~~~</color>
        }
      }

      Invalid value for selection field \`<red>name</color>\`: Not allowed
      "
    `)
  })

  test('nested select', () => {
    expect(
      renderError(
        {
          kind: 'InvalidSelectionValue',
          selectionPath: ['user', 'name'],
          underlyingError: 'Not allowed',
        },
        {
          select: {
            user: {
              select: {
                // @ts-expect-error
                name: undefined,
              },
            },
          },
        },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        select: {
          user: {
            select: {
              name: undefined
                    ~~~~~~~~~
            }
          }
        }
      }

      Invalid value for selection field \`name\`: Not allowed

      ------------------------------------

      Colored:

      {
        select: {
          user: {
            select: {
              name: <red>undefined</color>
                    <red>~~~~~~~~~</color>
            }
          }
        }
      }

      Invalid value for selection field \`<red>name</color>\`: Not allowed
      "
    `)
  })

  test('nested include', () => {
    expect(
      renderError(
        {
          kind: 'InvalidSelectionValue',
          selectionPath: ['user', 'name'],
          underlyingError: 'Not allowed',
        },
        {
          include: {
            user: {
              include: {
                // @ts-expect-error
                name: undefined,
              },
            },
          },
        },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        include: {
          user: {
            include: {
              name: undefined
                    ~~~~~~~~~
            }
          }
        }
      }

      Invalid value for selection field \`name\`: Not allowed

      ------------------------------------

      Colored:

      {
        include: {
          user: {
            include: {
              name: <red>undefined</color>
                    <red>~~~~~~~~~</color>
            }
          }
        }
      }

      Invalid value for selection field \`<red>name</color>\`: Not allowed
      "
    `)
  })

  test('nested omit', () => {
    expect(
      renderError(
        {
          kind: 'InvalidSelectionValue',
          selectionPath: ['user', 'password'],
          underlyingError: 'Not allowed',
        },
        {
          select: {
            user: {
              omit: {
                // @ts-expect-error
                password: undefined,
              },
            },
          },
        },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        select: {
          user: {
            omit: {
              password: undefined
                        ~~~~~~~~~
            }
          }
        }
      }

      Invalid value for selection field \`password\`: Not allowed

      ------------------------------------

      Colored:

      {
        select: {
          user: {
            omit: {
              password: <red>undefined</color>
                        <red>~~~~~~~~~</color>
            }
          }
        }
      }

      Invalid value for selection field \`<red>password</color>\`: Not allowed
      "
    `)
  })
})

describe('UnknownArgument', () => {
  test('top level with suggestion', () => {
    expect(
      renderError(
        {
          kind: 'UnknownArgument',
          selectionPath: [],
          argumentPath: ['wher'],
          arguments: [
            { name: 'where', typeNames: ['PostWhereInput'] },
            { name: 'orderBy', typeNames: ['PostOrderByWithRelationInput', 'List<PostOrderByWithRelationInput>'] },
            { name: 'take', typeNames: ['Int'] },
          ],
        },
        { wher: { id: 123 } },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        wher: {
        ~~~~
          id: 123
        },
      ? where?: PostWhereInput,
      ? orderBy?: PostOrderByWithRelationInput | List<PostOrderByWithRelationInput>,
      ? take?: Int
      }

      Unknown argument \`wher\`. Did you mean \`where\`? Available options are marked with ?.

      ------------------------------------

      Colored:

      {
        <red>wher</color>: {
        <red>~~~~</color>
          id: 123
        },
      <green>?</color> <green>where</color><green>?</color><green>: </color><green>PostWhereInput</color>,
      <green>?</color> <green>orderBy</color><green>?</color><green>: </color><green>PostOrderByWithRelationInput | List<PostOrderByWithRelationInput></color>,
      <green>?</color> <green>take</color><green>?</color><green>: </color><green>Int</color>
      }

      Unknown argument \`<red>wher</color>\`. Did you mean \`<green>where</color>\`? Available options are listed in <green>green</color>.
      "
    `)
  })

  test('top level with no suggestions', () => {
    expect(
      renderError(
        {
          kind: 'UnknownArgument',
          selectionPath: [],
          argumentPath: ['wher'],
          arguments: [],
        },
        { wher: { id: 123 } },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        wher: {
        ~~~~
          id: 123
        }
      }

      Unknown argument \`wher\`.

      ------------------------------------

      Colored:

      {
        <red>wher</color>: {
        <red>~~~~</color>
          id: 123
        }
      }

      Unknown argument \`<red>wher</color>\`.
      "
    `)
  })

  test('top level with large edit distance', () => {
    expect(
      renderError(
        {
          kind: 'UnknownArgument',
          selectionPath: [],
          argumentPath: ['completelyNotThere'],
          arguments: [
            { name: 'where', typeNames: ['PostWhereInput'] },
            { name: 'orderBy', typeNames: ['PostOrderByWithRelationInput', 'List<PostOrderByWithRelationInput>'] },
            { name: 'take', typeNames: ['Int'] },
          ],
        },
        { completelyNotThere: { id: 123 } },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        completelyNotThere: {
        ~~~~~~~~~~~~~~~~~~
          id: 123
        },
      ? where?: PostWhereInput,
      ? orderBy?: PostOrderByWithRelationInput | List<PostOrderByWithRelationInput>,
      ? take?: Int
      }

      Unknown argument \`completelyNotThere\`. Available options are marked with ?.

      ------------------------------------

      Colored:

      {
        <red>completelyNotThere</color>: {
        <red>~~~~~~~~~~~~~~~~~~</color>
          id: 123
        },
      <green>?</color> <green>where</color><green>?</color><green>: </color><green>PostWhereInput</color>,
      <green>?</color> <green>orderBy</color><green>?</color><green>: </color><green>PostOrderByWithRelationInput | List<PostOrderByWithRelationInput></color>,
      <green>?</color> <green>take</color><green>?</color><green>: </color><green>Int</color>
      }

      Unknown argument \`<red>completelyNotThere</color>\`. Available options are listed in <green>green</color>.
      "
    `)
  })

  test('nested selection', () => {
    expect(
      renderError(
        {
          kind: 'UnknownArgument',
          selectionPath: ['posts', 'comments'],
          argumentPath: ['wherr'],
          arguments: [
            { name: 'where', typeNames: ['CommentWhereInput'] },
            {
              name: 'orderBy',
              typeNames: ['CommentOrderByWithRelationInput', 'List<CommentOrderByWithRelationInput>'],
            },
            { name: 'take', typeNames: ['Int'] },
          ],
        },
        { include: { posts: { include: { comments: { wherr: { upvotes: 0 } } } } } },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        include: {
          posts: {
            include: {
              comments: {
                wherr: {
                ~~~~~
                  upvotes: 0
                },
      ?         where?: CommentWhereInput,
      ?         orderBy?: CommentOrderByWithRelationInput | List<CommentOrderByWithRelationInput>,
      ?         take?: Int
              }
            }
          }
        }
      }

      Unknown argument \`wherr\`. Did you mean \`where\`? Available options are marked with ?.

      ------------------------------------

      Colored:

      {
        include: {
          posts: {
            include: {
              comments: {
                <red>wherr</color>: {
                <red>~~~~~</color>
                  upvotes: 0
                },
      <green>?</color>         <green>where</color><green>?</color><green>: </color><green>CommentWhereInput</color>,
      <green>?</color>         <green>orderBy</color><green>?</color><green>: </color><green>CommentOrderByWithRelationInput | List<CommentOrderByWithRelationInput></color>,
      <green>?</color>         <green>take</color><green>?</color><green>: </color><green>Int</color>
              }
            }
          }
        }
      }

      Unknown argument \`<red>wherr</color>\`. Did you mean \`<green>where</color>\`? Available options are listed in <green>green</color>.
      "
    `)
  })
})

describe('UnknownInputField', () => {
  test('simple', () => {
    expect(
      renderError(
        {
          kind: 'UnknownInputField',
          selectionPath: [],
          argumentPath: ['where', 'upvote'],
          inputType: {
            kind: 'object',
            name: 'PostWhereInput',
            fields: [
              { name: 'id', required: false, typeNames: ['String'] },
              { name: 'name', required: false, typeNames: ['String'] },
              { name: 'upvotes', required: false, typeNames: ['Int', 'IntFilter'] },
            ],
          },
        },
        { where: { upvote: { gt: 0 } } },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        where: {
          upvote: {
          ~~~~~~
            gt: 0
          },
      ?   id?: String,
      ?   name?: String,
      ?   upvotes?: Int | IntFilter
        }
      }

      Unknown argument \`upvote\`. Did you mean \`upvotes\`? Available options are marked with ?.

      ------------------------------------

      Colored:

      {
        where: {
          <red>upvote</color>: {
          <red>~~~~~~</color>
            gt: 0
          },
      <green>?</color>   <green>id</color><green>?</color><green>: </color><green>String</color>,
      <green>?</color>   <green>name</color><green>?</color><green>: </color><green>String</color>,
      <green>?</color>   <green>upvotes</color><green>?</color><green>: </color><green>Int | IntFilter</color>
        }
      }

      Unknown argument \`<red>upvote</color>\`. Did you mean \`<green>upvotes</color>\`? Available options are listed in <green>green</color>.
      "
    `)
  })

  test('simple with large edit distance', () => {
    expect(
      renderError(
        {
          kind: 'UnknownInputField',
          selectionPath: [],
          argumentPath: ['where', 'somethingCompletelyDifferent'],
          inputType: {
            kind: 'object',
            name: 'PostWhereInput',
            fields: [
              { name: 'id', required: false, typeNames: ['String'] },
              { name: 'name', required: false, typeNames: ['String'] },
              { name: 'upvotes', required: false, typeNames: ['Int', 'IntFilter'] },
            ],
          },
        },
        { where: { somethingCompletelyDifferent: { gt: 0 } } },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        where: {
          somethingCompletelyDifferent: {
          ~~~~~~~~~~~~~~~~~~~~~~~~~~~~
            gt: 0
          },
      ?   id?: String,
      ?   name?: String,
      ?   upvotes?: Int | IntFilter
        }
      }

      Unknown argument \`somethingCompletelyDifferent\`. Available options are marked with ?.

      ------------------------------------

      Colored:

      {
        where: {
          <red>somethingCompletelyDifferent</color>: {
          <red>~~~~~~~~~~~~~~~~~~~~~~~~~~~~</color>
            gt: 0
          },
      <green>?</color>   <green>id</color><green>?</color><green>: </color><green>String</color>,
      <green>?</color>   <green>name</color><green>?</color><green>: </color><green>String</color>,
      <green>?</color>   <green>upvotes</color><green>?</color><green>: </color><green>Int | IntFilter</color>
        }
      }

      Unknown argument \`<red>somethingCompletelyDifferent</color>\`. Available options are listed in <green>green</color>.
      "
    `)
  })

  test('nested selection', () => {
    expect(
      renderError(
        {
          kind: 'UnknownInputField',
          selectionPath: ['posts'],
          argumentPath: ['where', 'upvote'],
          inputType: {
            kind: 'object',
            name: 'PostWhereInput',
            fields: [
              { name: 'id', required: false, typeNames: ['String'] },
              { name: 'name', required: false, typeNames: ['String'] },
              { name: 'upvotes', required: false, typeNames: ['Int', 'IntFilter'] },
            ],
          },
        },
        { include: { posts: { where: { upvote: { gt: 0 } } } } },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        include: {
          posts: {
            where: {
              upvote: {
              ~~~~~~
                gt: 0
              },
      ?       id?: String,
      ?       name?: String,
      ?       upvotes?: Int | IntFilter
            }
          }
        }
      }

      Unknown argument \`upvote\`. Did you mean \`upvotes\`? Available options are marked with ?.

      ------------------------------------

      Colored:

      {
        include: {
          posts: {
            where: {
              <red>upvote</color>: {
              <red>~~~~~~</color>
                gt: 0
              },
      <green>?</color>       <green>id</color><green>?</color><green>: </color><green>String</color>,
      <green>?</color>       <green>name</color><green>?</color><green>: </color><green>String</color>,
      <green>?</color>       <green>upvotes</color><green>?</color><green>: </color><green>Int | IntFilter</color>
            }
          }
        }
      }

      Unknown argument \`<red>upvote</color>\`. Did you mean \`<green>upvotes</color>\`? Available options are listed in <green>green</color>.
      "
    `)
  })
})

describe('RequiredArgumentMissing', () => {
  test('simple', () => {
    expect(
      renderError(
        {
          kind: 'RequiredArgumentMissing',
          argumentPath: ['where'],
          selectionPath: [],
          inputTypes: [
            {
              kind: 'object',
              name: 'UserWhereInput',
              fields: [
                { name: 'id', typeNames: ['Int'], required: false },
                { name: 'email', typeNames: ['String'], required: false },
              ],
            },
          ],
        },
        {},
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
      + where: {
      +   id: Int,
      +   email: String
      + }
      }

      Argument \`where\` is missing.

      ------------------------------------

      Colored:

      {
      <green>+</color> <green>where</color><green>: </color><green>{</color>
      <green><dim>+</intensity></color>   <green><dim>id: Int</intensity></color>,
      <green><dim>+</intensity></color>   <green><dim>email: String</intensity></color>
      <green>+</color> <green>}</color>
      }

      Argument \`<green>where</color>\` is missing.
      "
    `)
  })

  test('with null value', () => {
    expect(
      renderError(
        {
          kind: 'RequiredArgumentMissing',
          argumentPath: ['where'],
          selectionPath: [],
          inputTypes: [
            {
              kind: 'object',
              name: 'UserWhereInput',
              fields: [
                { name: 'id', typeNames: ['Int'], required: false },
                { name: 'email', typeNames: ['String'], required: false },
              ],
            },
          ],
        },
        { where: null },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
      + where: {
      +   id: Int,
      +   email: String
      + }
      }

      Argument \`where\` must not be null.

      ------------------------------------

      Colored:

      {
      <green>+</color> <green>where</color><green>: </color><green>{</color>
      <green><dim>+</intensity></color>   <green><dim>id: Int</intensity></color>,
      <green><dim>+</intensity></color>   <green><dim>email: String</intensity></color>
      <green>+</color> <green>}</color>
      }

      Argument \`<green>where</color>\` must not be <red>null</color>.
      "
    `)
  })

  test('field with multiple types', () => {
    expect(
      renderError(
        {
          kind: 'RequiredArgumentMissing',
          argumentPath: ['where'],
          selectionPath: [],
          inputTypes: [
            {
              kind: 'object',
              name: 'UserWhereInput',
              fields: [{ name: 'id', typeNames: ['Int', 'String'], required: false }],
            },
          ],
        },
        {},
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
      + where: {
      +   id: Int | String
      + }
      }

      Argument \`where\` is missing.

      ------------------------------------

      Colored:

      {
      <green>+</color> <green>where</color><green>: </color><green>{</color>
      <green><dim>+</intensity></color>   <green><dim>id: Int | String</intensity></color>
      <green>+</color> <green>}</color>
      }

      Argument \`<green>where</color>\` is missing.
      "
    `)
  })

  test('multiple input types', () => {
    expect(
      renderError(
        {
          kind: 'RequiredArgumentMissing',
          argumentPath: ['where'],
          selectionPath: [],
          inputTypes: [
            {
              kind: 'object',
              name: 'UserWhereInput',
              fields: [{ name: 'id', typeNames: ['Int', 'String'], required: false }],
            },

            {
              kind: 'object',
              name: 'UserBetterWhereInput',
              fields: [{ name: 'id', typeNames: ['Int', 'String'], required: false }],
            },
          ],
        },
        {},
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
      + where: UserWhereInput | UserBetterWhereInput
      }

      Argument \`where\` is missing.

      ------------------------------------

      Colored:

      {
      <green>+</color> <green>where</color><green>: </color><green>UserWhereInput | UserBetterWhereInput</color>
      }

      Argument \`<green>where</color>\` is missing.
      "
    `)
  })

  test('with list', () => {
    expect(
      renderError(
        {
          kind: 'RequiredArgumentMissing',
          argumentPath: ['data'],
          selectionPath: [],
          inputTypes: [
            {
              kind: 'list',
              elementType: {
                kind: 'object',
                name: 'UserCreateInput',
                fields: [],
              },
            },
          ],
        },
        {},
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
      + data: UserCreateInput[]
      }

      Argument \`data\` is missing.

      ------------------------------------

      Colored:

      {
      <green>+</color> <green>data</color><green>: </color><green>UserCreateInput[]</color>
      }

      Argument \`<green>data</color>\` is missing.
      "
    `)
  })

  test('nested argument', () => {
    expect(
      renderError(
        {
          kind: 'RequiredArgumentMissing',
          argumentPath: ['data', 'email'],
          selectionPath: [],
          inputTypes: [
            {
              kind: 'scalar',
              name: 'String',
            },
          ],
        },
        { data: {} },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        data: {
      +   email: String
        }
      }

      Argument \`email\` is missing.

      ------------------------------------

      Colored:

      {
        data: {
      <green>+</color>   <green>email</color><green>: </color><green>String</color>
        }
      }

      Argument \`<green>email</color>\` is missing.
      "
    `)
  })

  test('nested selection', () => {
    expect(
      renderError(
        {
          kind: 'RequiredArgumentMissing',
          argumentPath: ['where'],
          selectionPath: ['user'],
          inputTypes: [
            {
              kind: 'object',
              name: 'UserWhereInput',
              fields: [
                { name: 'id', typeNames: ['Int'], required: false },
                { name: 'email', typeNames: ['String'], required: false },
              ],
            },
          ],
        },
        {
          select: {
            user: {},
          },
        },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        select: {
          user: {
      +     where: {
      +       id: Int,
      +       email: String
      +     }
          }
        }
      }

      Argument \`where\` is missing.

      ------------------------------------

      Colored:

      {
        select: {
          user: {
      <green>+</color>     <green>where</color><green>: </color><green>{</color>
      <green><dim>+</intensity></color>       <green><dim>id: Int</intensity></color>,
      <green><dim>+</intensity></color>       <green><dim>email: String</intensity></color>
      <green>+</color>     <green>}</color>
          }
        }
      }

      Argument \`<green>where</color>\` is missing.
      "
    `)
  })

  test('dependent argument', () => {
    expect(
      renderError(
        {
          kind: 'RequiredArgumentMissing',
          argumentPath: ['orderBy'],
          dependentArgumentPath: ['take'],
          selectionPath: ['userView'],
          inputTypes: [
            {
              kind: 'object',
              name: 'UserViewOrderByInput',
              fields: [{ name: 'id', typeNames: ['Int'], required: false }],
            },
          ],
        },
        {
          select: {
            userView: {
              take: 1,
            },
          },
        },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        select: {
          userView: {
            take: 1,
            ~~~~
      +     orderBy: {
      +       id: Int
      +     }
          }
        }
      }

      Argument \`orderBy\` is missing.
      Argument \`orderBy\` is required because argument \`take\` was provided.

      ------------------------------------

      Colored:

      {
        select: {
          userView: {
            <red>take</color>: 1,
            <red>~~~~</color>
      <green>+</color>     <green>orderBy</color><green>: </color><green>{</color>
      <green><dim>+</intensity></color>       <green><dim>id: Int</intensity></color>
      <green>+</color>     <green>}</color>
          }
        }
      }

      Argument \`<green>orderBy</color>\` is missing.
      Argument \`<green>orderBy</color>\` is required because argument \`<green>take</color>\` was provided.
      "
    `)
  })

  test('dependent argument when dependency is set to null', () => {
    expect(
      renderError(
        {
          kind: 'RequiredArgumentMissing',
          argumentPath: ['orderBy'],
          dependentArgumentPath: ['take'],
          selectionPath: ['userView'],
          inputTypes: [
            {
              kind: 'object',
              name: 'UserViewOrderByInput',
              fields: [{ name: 'id', typeNames: ['Int'], required: false }],
            },
          ],
        },
        {
          select: {
            userView: {
              orderBy: null,
              take: 1,
            },
          },
        },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        select: {
          userView: {
            take: 1,
            ~~~~
      +     orderBy: {
      +       id: Int
      +     }
          }
        }
      }

      Argument \`orderBy\` must not be null.
      Argument \`orderBy\` is required because argument \`take\` was provided.

      ------------------------------------

      Colored:

      {
        select: {
          userView: {
            <red>take</color>: 1,
            <red>~~~~</color>
      <green>+</color>     <green>orderBy</color><green>: </color><green>{</color>
      <green><dim>+</intensity></color>       <green><dim>id: Int</intensity></color>
      <green>+</color>     <green>}</color>
          }
        }
      }

      Argument \`<green>orderBy</color>\` must not be <red>null</color>.
      Argument \`<green>orderBy</color>\` is required because argument \`<green>take</color>\` was provided.
      "
    `)
  })
})

describe('InvalidArgumentType', () => {
  test('simple', () => {
    expect(
      renderError(
        {
          kind: 'InvalidArgumentType',
          selectionPath: [],
          argumentPath: ['where', 'id'],
          argument: { name: 'id', typeNames: ['String'] },
          inferredType: 'Int',
        },
        { where: { id: 123 } },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        where: {
          id: 123
              ~~~
        }
      }

      Argument \`id\`: Invalid value provided. Expected String, provided Int.

      ------------------------------------

      Colored:

      {
        where: {
          id: <red>123</color>
              <red>~~~</color>
        }
      }

      Argument \`<bold>id</intensity>\`: Invalid value provided. Expected <green>String</color>, provided <red>Int</color>.
      "
    `)
  })

  test('nested argument', () => {
    expect(
      renderError(
        {
          kind: 'InvalidArgumentType',
          selectionPath: [],
          argumentPath: ['where', 'id', 'contains'],
          argument: { name: 'contains', typeNames: ['String'] },
          inferredType: 'Int',
        },
        { where: { id: { contains: 123 } } },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        where: {
          id: {
            contains: 123
                      ~~~
          }
        }
      }

      Argument \`contains\`: Invalid value provided. Expected String, provided Int.

      ------------------------------------

      Colored:

      {
        where: {
          id: {
            contains: <red>123</color>
                      <red>~~~</color>
          }
        }
      }

      Argument \`<bold>contains</intensity>\`: Invalid value provided. Expected <green>String</color>, provided <red>Int</color>.
      "
    `)
  })

  test('multiple expected types', () => {
    expect(
      renderError(
        {
          kind: 'InvalidArgumentType',
          selectionPath: [],
          argumentPath: ['where', 'id'],
          argument: { name: 'id', typeNames: ['String', 'StringFilter'] },
          inferredType: 'Int',
        },
        { where: { id: 123 } },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        where: {
          id: 123
              ~~~
        }
      }

      Argument \`id\`: Invalid value provided. Expected String or StringFilter, provided Int.

      ------------------------------------

      Colored:

      {
        where: {
          id: <red>123</color>
              <red>~~~</color>
        }
      }

      Argument \`<bold>id</intensity>\`: Invalid value provided. Expected <green>String</color> or <green>StringFilter</color>, provided <red>Int</color>.
      "
    `)
  })

  test('nested selection', () => {
    expect(
      renderError(
        {
          kind: 'InvalidArgumentType',
          selectionPath: ['posts'],
          argumentPath: ['where', 'published'],
          argument: { name: 'published', typeNames: ['Boolean'] },
          inferredType: 'String',
        },
        { include: { posts: { where: { published: 'yes' } } } },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        include: {
          posts: {
            where: {
              published: "yes"
                         ~~~~~
            }
          }
        }
      }

      Argument \`published\`: Invalid value provided. Expected Boolean, provided String.

      ------------------------------------

      Colored:

      {
        include: {
          posts: {
            where: {
              published: <red>"yes"</color>
                         <red>~~~~~</color>
            }
          }
        }
      }

      Argument \`<bold>published</intensity>\`: Invalid value provided. Expected <green>Boolean</color>, provided <red>String</color>.
      "
    `)
  })

  test('nested selection and argument', () => {
    expect(
      renderError(
        {
          kind: 'InvalidArgumentType',
          selectionPath: ['posts'],
          argumentPath: ['where', 'publishedDate', 'gt'],
          argument: { name: 'gt', typeNames: ['Date'] },
          inferredType: 'String',
        },
        { include: { posts: { where: { publishedDate: { gt: 'now' } } } } },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        include: {
          posts: {
            where: {
              publishedDate: {
                gt: "now"
                    ~~~~~
              }
            }
          }
        }
      }

      Argument \`gt\`: Invalid value provided. Expected Date, provided String.

      ------------------------------------

      Colored:

      {
        include: {
          posts: {
            where: {
              publishedDate: {
                gt: <red>"now"</color>
                    <red>~~~~~</color>
              }
            }
          }
        }
      }

      Argument \`<bold>gt</intensity>\`: Invalid value provided. Expected <green>Date</color>, provided <red>String</color>.
      "
    `)
  })
})

describe('ValueTooLarge', () => {
  test('simple', () => {
    expect(
      renderError(
        {
          kind: 'ValueTooLarge',
          selectionPath: [],
          argumentPath: ['where', 'number'],
          argument: { name: 'number', typeNames: ['BigInt'] },
        },
        { where: { number: 1e20 } },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        where: {
          number: 100000000000000000000
                  ~~~~~~~~~~~~~~~~~~~~~
        }
      }

      Unable to fit value 100000000000000000000 into a 64-bit signed integer for field \`number\`

      ------------------------------------

      Colored:

      {
        where: {
          number: <red>100000000000000000000</color>
                  <red>~~~~~~~~~~~~~~~~~~~~~</color>
        }
      }

      Unable to fit value <red>100000000000000000000</color> into a 64-bit signed integer for field \`<bold>number</intensity>\`
      "
    `)
  })

  test('nested argument', () => {
    expect(
      renderError(
        {
          kind: 'ValueTooLarge',
          selectionPath: [],
          argumentPath: ['where', 'number', 'gt'],
          argument: { name: 'gt', typeNames: ['BigInt'] },
        },
        { where: { number: { gt: 1e20 } } },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        where: {
          number: {
            gt: 100000000000000000000
                ~~~~~~~~~~~~~~~~~~~~~
          }
        }
      }

      Unable to fit value 100000000000000000000 into a 64-bit signed integer for field \`gt\`

      ------------------------------------

      Colored:

      {
        where: {
          number: {
            gt: <red>100000000000000000000</color>
                <red>~~~~~~~~~~~~~~~~~~~~~</color>
          }
        }
      }

      Unable to fit value <red>100000000000000000000</color> into a 64-bit signed integer for field \`<bold>gt</intensity>\`
      "
    `)
  })

  test('nested selection', () => {
    expect(
      renderError(
        {
          kind: 'ValueTooLarge',
          selectionPath: ['posts'],
          argumentPath: ['where', 'number'],
          argument: { name: 'number', typeNames: ['BigInt'] },
        },
        { include: { posts: { where: { number: 1e20 } } } },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        include: {
          posts: {
            where: {
              number: 100000000000000000000
                      ~~~~~~~~~~~~~~~~~~~~~
            }
          }
        }
      }

      Unable to fit value 100000000000000000000 into a 64-bit signed integer for field \`number\`

      ------------------------------------

      Colored:

      {
        include: {
          posts: {
            where: {
              number: <red>100000000000000000000</color>
                      <red>~~~~~~~~~~~~~~~~~~~~~</color>
            }
          }
        }
      }

      Unable to fit value <red>100000000000000000000</color> into a 64-bit signed integer for field \`<bold>number</intensity>\`
      "
    `)
  })

  test('nested selection and argument', () => {
    expect(
      renderError(
        {
          kind: 'ValueTooLarge',
          selectionPath: ['posts'],
          argumentPath: ['where', 'number', 'gt'],
          argument: { name: 'number', typeNames: ['BigInt'] },
        },
        { include: { posts: { where: { number: { gt: 1e20 } } } } },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        include: {
          posts: {
            where: {
              number: {
                gt: 100000000000000000000
                    ~~~~~~~~~~~~~~~~~~~~~
              }
            }
          }
        }
      }

      Unable to fit value 100000000000000000000 into a 64-bit signed integer for field \`number\`

      ------------------------------------

      Colored:

      {
        include: {
          posts: {
            where: {
              number: {
                gt: <red>100000000000000000000</color>
                    <red>~~~~~~~~~~~~~~~~~~~~~</color>
              }
            }
          }
        }
      }

      Unable to fit value <red>100000000000000000000</color> into a 64-bit signed integer for field \`<bold>number</intensity>\`
      "
    `)
  })
})

describe('InvalidArgumentValue', () => {
  test('simple', () => {
    expect(
      renderError(
        {
          kind: 'InvalidArgumentValue',
          selectionPath: [],
          argumentPath: ['where', 'createdAt'],
          argument: { name: 'createdAt', typeNames: ['IS0861 DateTime'] },
          underlyingError: 'Invalid characters',
        },
        { where: { createdAt: 'now' } },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        where: {
          createdAt: "now"
                     ~~~~~
        }
      }

      Invalid value for argument \`createdAt\`: Invalid characters. Expected IS0861 DateTime.

      ------------------------------------

      Colored:

      {
        where: {
          createdAt: <red>"now"</color>
                     <red>~~~~~</color>
        }
      }

      Invalid value for argument \`<bold>createdAt</intensity>\`: Invalid characters. Expected <green>IS0861 DateTime</color>.
      "
    `)
  })

  test('with no underlying error', () => {
    expect(
      renderError(
        {
          kind: 'InvalidArgumentValue',
          selectionPath: [],
          argumentPath: ['where', 'createdAt'],
          argument: { name: 'createdAt', typeNames: ['IS0861 DateTime'] },
          underlyingError: null,
        },
        { where: { createdAt: 'now' } },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        where: {
          createdAt: "now"
                     ~~~~~
        }
      }

      Invalid value for argument \`createdAt\`. Expected IS0861 DateTime.

      ------------------------------------

      Colored:

      {
        where: {
          createdAt: <red>"now"</color>
                     <red>~~~~~</color>
        }
      }

      Invalid value for argument \`<bold>createdAt</intensity>\`. Expected <green>IS0861 DateTime</color>.
      "
    `)
  })

  test('nested argument', () => {
    expect(
      renderError(
        {
          kind: 'InvalidArgumentValue',
          selectionPath: [],
          argumentPath: ['where', 'createdAt', 'gt'],
          argument: { name: 'createdAt', typeNames: ['IS0861 DateTime'] },
          underlyingError: 'Invalid characters',
        },
        { where: { createdAt: { gt: 'now' } } },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        where: {
          createdAt: {
            gt: "now"
                ~~~~~
          }
        }
      }

      Invalid value for argument \`createdAt\`: Invalid characters. Expected IS0861 DateTime.

      ------------------------------------

      Colored:

      {
        where: {
          createdAt: {
            gt: <red>"now"</color>
                <red>~~~~~</color>
          }
        }
      }

      Invalid value for argument \`<bold>createdAt</intensity>\`: Invalid characters. Expected <green>IS0861 DateTime</color>.
      "
    `)
  })

  test('nested selection', () => {
    expect(
      renderError(
        {
          kind: 'InvalidArgumentValue',
          selectionPath: ['posts'],
          argumentPath: ['where', 'createdAt'],
          argument: { name: 'createdAt', typeNames: ['ISO8601 DateTime'] },
          underlyingError: 'Invalid characters',
        },
        { include: { posts: { where: { createdAt: 'yes' } } } },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        include: {
          posts: {
            where: {
              createdAt: "yes"
                         ~~~~~
            }
          }
        }
      }

      Invalid value for argument \`createdAt\`: Invalid characters. Expected ISO8601 DateTime.

      ------------------------------------

      Colored:

      {
        include: {
          posts: {
            where: {
              createdAt: <red>"yes"</color>
                         <red>~~~~~</color>
            }
          }
        }
      }

      Invalid value for argument \`<bold>createdAt</intensity>\`: Invalid characters. Expected <green>ISO8601 DateTime</color>.
      "
    `)
  })

  test('nested selection and argument', () => {
    expect(
      renderError(
        {
          kind: 'InvalidArgumentValue',
          selectionPath: ['posts'],
          argumentPath: ['where', 'createdAt', 'equals'],
          argument: { name: 'equals', typeNames: ['ISO8601 DateTime'] },
          underlyingError: 'Invalid characters',
        },
        { include: { posts: { where: { createdAt: { equals: 'yes' } } } } },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        include: {
          posts: {
            where: {
              createdAt: {
                equals: "yes"
                        ~~~~~
              }
            }
          }
        }
      }

      Invalid value for argument \`equals\`: Invalid characters. Expected ISO8601 DateTime.

      ------------------------------------

      Colored:

      {
        include: {
          posts: {
            where: {
              createdAt: {
                equals: <red>"yes"</color>
                        <red>~~~~~</color>
              }
            }
          }
        }
      }

      Invalid value for argument \`<bold>equals</intensity>\`: Invalid characters. Expected <green>ISO8601 DateTime</color>.
      "
    `)
  })
})

describe('Union', () => {
  test('longest path', () => {
    expect(
      renderError(
        {
          kind: 'Union',
          errors: [
            {
              kind: 'InvalidArgumentType',
              selectionPath: [],
              argumentPath: ['where', 'email', 'gt'],
              argument: { name: 'gt', typeNames: ['String'] },
              inferredType: 'Int',
            },

            {
              kind: 'InvalidArgumentType',
              selectionPath: [],
              argumentPath: ['where', 'email'],
              argument: { name: 'email', typeNames: ['String'] },
              inferredType: 'Object',
            },
          ],
        },
        {
          where: { email: { gt: 123 } },
        },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        where: {
          email: {
            gt: 123
                ~~~
          }
        }
      }

      Argument \`gt\`: Invalid value provided. Expected String, provided Int.

      ------------------------------------

      Colored:

      {
        where: {
          email: {
            gt: <red>123</color>
                <red>~~~</color>
          }
        }
      }

      Argument \`<bold>gt</intensity>\`: Invalid value provided. Expected <green>String</color>, provided <red>Int</color>.
      "
    `)
  })

  test('longest path - nested uinion', () => {
    expect(
      renderError(
        {
          kind: 'Union',
          errors: [
            {
              kind: 'Union',
              errors: [
                {
                  kind: 'InvalidArgumentType',
                  selectionPath: [],
                  argumentPath: ['where', 'email', 'gt'],
                  argument: { name: 'gt', typeNames: ['String'] },
                  inferredType: 'Int',
                },

                {
                  kind: 'InvalidArgumentType',
                  selectionPath: [],
                  argumentPath: ['where', 'email'],
                  argument: { name: 'email', typeNames: ['String'] },
                  inferredType: 'Object',
                },
              ],
            },
          ],
        },
        {
          where: { email: { gt: 123 } },
        },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        where: {
          email: {
            gt: 123
                ~~~
          }
        }
      }

      Argument \`gt\`: Invalid value provided. Expected String, provided Int.

      ------------------------------------

      Colored:

      {
        where: {
          email: {
            gt: <red>123</color>
                <red>~~~</color>
          }
        }
      }

      Argument \`<bold>gt</intensity>\`: Invalid value provided. Expected <green>String</color>, provided <red>Int</color>.
      "
    `)
  })

  test('merge', () => {
    expect(
      renderError(
        {
          kind: 'Union',
          errors: [
            {
              kind: 'InvalidArgumentType',
              selectionPath: [],
              argumentPath: ['where', 'email'],
              argument: { name: 'email', typeNames: ['String'] },
              inferredType: 'Int',
            },

            {
              kind: 'InvalidArgumentType',
              selectionPath: [],
              argumentPath: ['where', 'email'],
              argument: { name: 'email', typeNames: ['StringFilter'] },
              inferredType: 'Int',
            },
          ],
        },
        {
          where: { email: 123 },
        },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        where: {
          email: 123
                 ~~~
        }
      }

      Argument \`email\`: Invalid value provided. Expected String or StringFilter, provided Int.

      ------------------------------------

      Colored:

      {
        where: {
          email: <red>123</color>
                 <red>~~~</color>
        }
      }

      Argument \`<bold>email</intensity>\`: Invalid value provided. Expected <green>String</color> or <green>StringFilter</color>, provided <red>Int</color>.
      "
    `)
  })

  test('same length path, different error types', () => {
    expect(
      renderError(
        {
          kind: 'Union',
          errors: [
            {
              kind: 'RequiredArgumentMissing',
              selectionPath: [],
              argumentPath: ['data', 'profile'],
              inputTypes: [
                {
                  kind: 'object',
                  name: 'ProfileCreateInput',
                  fields: [{ name: 'create', typeNames: ['ProfileUniqueInput'], required: true }],
                },
              ],
            },

            {
              kind: 'InvalidArgumentType',
              selectionPath: [],
              argumentPath: ['data', 'email'],
              argument: { name: 'email', typeNames: ['String'] },
              inferredType: 'Int',
            },
          ],
        },
        {
          data: { email: 123 },
        },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        data: {
          email: 123
                 ~~~
        }
      }

      Argument \`email\`: Invalid value provided. Expected String, provided Int.

      ------------------------------------

      Colored:

      {
        data: {
          email: <red>123</color>
                 <red>~~~</color>
        }
      }

      Argument \`<bold>email</intensity>\`: Invalid value provided. Expected <green>String</color>, provided <red>Int</color>.
      "
    `)
  })
})

describe('SomeFieldsMissing', () => {
  test('simple', () => {
    expect(
      renderError(
        {
          kind: 'SomeFieldsMissing',
          selectionPath: [],
          argumentPath: ['where'],
          inputType: {
            kind: 'object',
            name: 'UserWhereUniqueInput',
            fields: [
              { name: 'id', typeNames: ['String'], required: false },
              { name: 'email', typeNames: ['String'], required: false },
            ],
          },
          constraints: { minFieldCount: 1, requiredFields: null },
        },
        { where: {} },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        where: {
      ?   id?: String,
      ?   email?: String
        }
      }

      Argument \`where\` of type UserWhereUniqueInput needs at least one argument. Available options are marked with ?.

      ------------------------------------

      Colored:

      {
        where: {
      <green>?</color>   <green>id</color><green>?</color><green>: </color><green>String</color>,
      <green>?</color>   <green>email</color><green>?</color><green>: </color><green>String</color>
        }
      }

      Argument \`<bold>where</intensity>\` of type <bold>UserWhereUniqueInput</intensity> needs <green>at least one</color> argument. Available options are listed in <green>green</color>.
      "
    `)
  })

  test('multiple', () => {
    expect(
      renderError(
        {
          kind: 'SomeFieldsMissing',
          selectionPath: [],
          argumentPath: ['where'],
          inputType: {
            kind: 'object',
            name: 'UserWhereUniqueInput',
            fields: [
              { name: 'id', typeNames: ['String'], required: false },
              { name: 'email', typeNames: ['String'], required: false },
            ],
          },
          constraints: { minFieldCount: 2, requiredFields: null },
        },
        { where: {} },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        where: {
      ?   id?: String,
      ?   email?: String
        }
      }

      Argument \`where\` of type UserWhereUniqueInput needs at least 2 arguments. Available options are marked with ?.

      ------------------------------------

      Colored:

      {
        where: {
      <green>?</color>   <green>id</color><green>?</color><green>: </color><green>String</color>,
      <green>?</color>   <green>email</color><green>?</color><green>: </color><green>String</color>
        }
      }

      Argument \`<bold>where</intensity>\` of type <bold>UserWhereUniqueInput</intensity> needs <green>at least 2</color> arguments. Available options are listed in <green>green</color>.
      "
    `)
  })

  test('nested selection', () => {
    expect(
      renderError(
        {
          kind: 'SomeFieldsMissing',
          selectionPath: ['user'],
          argumentPath: ['where'],
          inputType: {
            kind: 'object',
            name: 'UserWhereUniqueInput',
            fields: [
              { name: 'id', typeNames: ['String'], required: false },
              { name: 'email', typeNames: ['String'], required: false },
            ],
          },
          constraints: { minFieldCount: 1, requiredFields: null },
        },
        { include: { user: { where: {} } } },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        include: {
          user: {
            where: {
      ?       id?: String,
      ?       email?: String
            }
          }
        }
      }

      Argument \`where\` of type UserWhereUniqueInput needs at least one argument. Available options are marked with ?.

      ------------------------------------

      Colored:

      {
        include: {
          user: {
            where: {
      <green>?</color>       <green>id</color><green>?</color><green>: </color><green>String</color>,
      <green>?</color>       <green>email</color><green>?</color><green>: </color><green>String</color>
            }
          }
        }
      }

      Argument \`<bold>where</intensity>\` of type <bold>UserWhereUniqueInput</intensity> needs <green>at least one</color> argument. Available options are listed in <green>green</color>.
      "
    `)
  })

  test('with required fields', () => {
    expect(
      renderError(
        {
          kind: 'SomeFieldsMissing',
          selectionPath: [],
          argumentPath: ['where'],
          inputType: {
            kind: 'object',
            name: 'UserWhereUniqueInput',
            fields: [
              { name: 'id', typeNames: ['String'], required: false },
              { name: 'email', typeNames: ['String'], required: false },
            ],
          },
          constraints: { minFieldCount: 1, requiredFields: ['id', 'email'] },
        },
        { where: {} },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        where: {
      ?   id?: String,
      ?   email?: String
        }
      }

      Argument \`where\` of type UserWhereUniqueInput needs at least one of \`id\` or \`email\` arguments. Available options are marked with ?.

      ------------------------------------

      Colored:

      {
        where: {
      <green>?</color>   <green>id</color><green>?</color><green>: </color><green>String</color>,
      <green>?</color>   <green>email</color><green>?</color><green>: </color><green>String</color>
        }
      }

      Argument \`<bold>where</intensity>\` of type <bold>UserWhereUniqueInput</intensity> needs <green>at least one of</color> \`<bold>id</intensity>\` or \`<bold>email</intensity>\` arguments. Available options are listed in <green>green</color>.
      "
    `)
  })
})

describe('TooManyFieldsGiven', () => {
  test('exactly one', () => {
    expect(
      renderError(
        {
          kind: 'TooManyFieldsGiven',
          selectionPath: [],
          argumentPath: ['where'],
          inputType: {
            kind: 'object',
            name: 'UserWhereUniqueInput',
            fields: [
              { name: 'id', typeNames: ['String'], required: false },
              { name: 'email', typeNames: ['String'], required: false },
            ],
          },
          constraints: { minFieldCount: 1, maxFieldCount: 1, requiredFields: null },
        },
        {
          where: {
            id: 'foo',
            email: 'foo@example.com',
          },
        },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        where: {
          id: "foo",
          email: "foo@example.com"
        }
        ~~~~~~~~~~~~~~~~~~~~~~~~~~
      }

      Argument \`where\` of type UserWhereUniqueInput needs exactly one argument, but you provided id and email. Please choose one.

      ------------------------------------

      Colored:

      {
        where: {
          id: "foo",
          email: "foo@example.com"
        }
        <red>~~~~~~~~~~~~~~~~~~~~~~~~~~</color>
      }

      Argument \`<bold>where</intensity>\` of type <bold>UserWhereUniqueInput</intensity> needs <green>exactly one</color> argument, but you provided <red>id</color> and <red>email</color>. Please choose one.
      "
    `)
  })

  test('at most one', () => {
    expect(
      renderError(
        {
          kind: 'TooManyFieldsGiven',
          selectionPath: [],
          argumentPath: ['where'],
          inputType: {
            kind: 'object',
            name: 'UserWhereUniqueInput',
            fields: [
              { name: 'id', typeNames: ['String'], required: false },
              { name: 'email', typeNames: ['String'], required: false },
            ],
          },
          constraints: { maxFieldCount: 1, requiredFields: null },
        },
        {
          where: {
            id: 'foo',
            email: 'foo@example.com',
          },
        },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        where: {
          id: "foo",
          email: "foo@example.com"
        }
        ~~~~~~~~~~~~~~~~~~~~~~~~~~
      }

      Argument \`where\` of type UserWhereUniqueInput needs at most one argument, but you provided id and email. Please choose one.

      ------------------------------------

      Colored:

      {
        where: {
          id: "foo",
          email: "foo@example.com"
        }
        <red>~~~~~~~~~~~~~~~~~~~~~~~~~~</color>
      }

      Argument \`<bold>where</intensity>\` of type <bold>UserWhereUniqueInput</intensity> needs <green>at most one</color> argument, but you provided <red>id</color> and <red>email</color>. Please choose one.
      "
    `)
  })

  test('more than one', () => {
    expect(
      renderError(
        {
          kind: 'TooManyFieldsGiven',
          selectionPath: [],
          argumentPath: ['where'],
          inputType: {
            kind: 'object',
            name: 'UserWhereUniqueInput',
            fields: [
              { name: 'id', typeNames: ['String'], required: false },
              { name: 'email', typeNames: ['String'], required: false },
            ],
          },
          constraints: { maxFieldCount: 2, requiredFields: null },
        },
        {
          where: {
            id: 'foo',
            email: 'foo@example.com',
            nickname: 'bar',
          },
        },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        where: {
          id: "foo",
          email: "foo@example.com",
          nickname: "bar"
        }
        ~~~~~~~~~~~~~~~~~~~~~~~~~~
      }

      Argument \`where\` of type UserWhereUniqueInput needs at most 2 arguments, but you provided id, email and nickname. Please choose 2.

      ------------------------------------

      Colored:

      {
        where: {
          id: "foo",
          email: "foo@example.com",
          nickname: "bar"
        }
        <red>~~~~~~~~~~~~~~~~~~~~~~~~~~</color>
      }

      Argument \`<bold>where</intensity>\` of type <bold>UserWhereUniqueInput</intensity> needs <green>at most 2</color> arguments, but you provided <red>id</color>, <red>email</color> and <red>nickname</color>. Please choose 2.
      "
    `)
  })

  test('nested selection', () => {
    expect(
      renderError(
        {
          kind: 'TooManyFieldsGiven',
          selectionPath: ['user'],
          argumentPath: ['where'],
          inputType: {
            kind: 'object',
            name: 'UserWhereUniqueInput',
            fields: [
              { name: 'id', typeNames: ['String'], required: false },
              { name: 'email', typeNames: ['String'], required: false },
            ],
          },
          constraints: { minFieldCount: 1, maxFieldCount: 1, requiredFields: null },
        },
        {
          select: {
            user: {
              where: {
                id: 'foo',
                email: 'foo@example.com',
              },
            },
          },
        },
      ),
    ).toMatchInlineSnapshot(`
      "
      Colorless:

      {
        select: {
          user: {
            where: {
              id: "foo",
              email: "foo@example.com"
            }
            ~~~~~~~~~~~~~~~~~~~~~~~~~~
          }
        }
      }

      Argument \`where\` of type UserWhereUniqueInput needs exactly one argument, but you provided id and email. Please choose one.

      ------------------------------------

      Colored:

      {
        select: {
          user: {
            where: {
              id: "foo",
              email: "foo@example.com"
            }
            <red>~~~~~~~~~~~~~~~~~~~~~~~~~~</color>
          }
        }
      }

      Argument \`<bold>where</intensity>\` of type <bold>UserWhereUniqueInput</intensity> needs <green>exactly one</color> argument, but you provided <red>id</color> and <red>email</color>. Please choose one.
      "
    `)
  })
})
