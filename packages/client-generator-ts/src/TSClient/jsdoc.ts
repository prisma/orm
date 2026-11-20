import { capitalize, uncapitalize } from '@prisma/client-common'
import type * as DMMF from '@prisma/dmmf'

import { getGroupByArgsName, getModelArgName } from '../utils'

export interface JSDocMethodBodyCtx {
  singular: string
  plural: string
  firstScalar: DMMF.Field | undefined
  method: string
  model: DMMF.Model
  action: DMMF.ModelAction
  mapping: DMMF.ModelMapping
}

const Docs = {
  cursor: `{@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}`,
  pagination: `{@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}`,
  aggregations: `{@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}`,
  distinct: `{@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}`,
  sorting: `{@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}`,
}

type JSDocsType = {
  [action in DMMF.ModelAction]: {
    body: (ctx: JSDocMethodBodyCtx) => string
    fields: {
      [field: string]: (singular: string, plural: string) => string
    }
  }
}

function addLinkToDocs(comment: string, docs: keyof typeof Docs) {
  return `${Docs[docs]}

${comment}`
}
function getDeprecationString(since: string, replacement: string) {
  return `@deprecated since ${since} please use \`${replacement}\``
}
const undefinedNote = `Note, that providing \`undefined\` is treated as the value not being there.
Read more here: https://pris.ly/d/null-undefined`

const JSDocFields = {
  take: (singular, plural) => addLinkToDocs(`Take \`±n\` ${plural} from the position of the cursor.`, 'pagination'),
  skip: (singular, plural) => addLinkToDocs(`Skip the first \`n\` ${plural}.`, 'pagination'),
  _count: (singular, plural) => addLinkToDocs(`Count returned ${plural}`, 'aggregations'),
  _avg: () => addLinkToDocs(`Select which fields to average`, 'aggregations'),
  _sum: () => addLinkToDocs(`Select which fields to sum`, 'aggregations'),
  _min: () => addLinkToDocs(`Select which fields to find the minimum value`, 'aggregations'),
  _max: () => addLinkToDocs(`Select which fields to find the maximum value`, 'aggregations'),
  count: () => getDeprecationString('2.23.0', '_count'),
  avg: () => getDeprecationString('2.23.0', '_avg'),
  sum: () => getDeprecationString('2.23.0', '_sum'),
  min: () => getDeprecationString('2.23.0', '_min'),
  max: () => getDeprecationString('2.23.0', '_max'),
  distinct: (singular, plural) => addLinkToDocs(`Filter by unique combinations of ${plural}.`, 'distinct'),
  orderBy: (singular, plural) => addLinkToDocs(`Determine the order of ${plural} to fetch.`, 'sorting'),
}
export const JSDocs: JSDocsType = {
  groupBy: {
    body: (ctx) => `Group by ${ctx.singular}.
${undefinedNote}
@param {${getGroupByArgsName(ctx.model.name)}} args - Group by arguments.
@example
// Group by city, order by createdAt, get count
const result = await prisma.user.groupBy({
  by: ['city', 'createdAt'],
  orderBy: {
    createdAt: true
  },
  _count: {
    _all: true
  },
})
`,
    fields: {},
  },
  create: {
    body: (ctx) => `Create a ${ctx.singular}.
@param {${getModelArgName(ctx.model.name, ctx.action)}} args - Arguments to create a ${ctx.singular}.
@example
// Create one ${ctx.singular}
const ${ctx.singular} = await ${ctx.method}({
  data: {
    // ... data to create a ${ctx.singular}
  }
})
`,
    fields: {
      data: (singular) => `The data needed to create a ${singular}.`,
    },
  },
  createMany: {
    body: (ctx) => `Create many ${ctx.plural}.
@param {${getModelArgName(ctx.model.name, ctx.action)}} args - Arguments to create many ${ctx.plural}.
@example
// Create many ${ctx.plural}
const ${uncapitalize(ctx.mapping.model)} = await ${ctx.method}({
  data: [
    // ... provide data here
  ]
})
    `,
    fields: {
      data: (singular, plural) => `The data used to create many ${plural}.`,
    },
  },
  createManyAndReturn: {
    body: (ctx) => {
      const onlySelect = ctx.firstScalar
        ? `\n// Create many ${ctx.plural} and only return the \`${ctx.firstScalar.name}\`
const ${uncapitalize(ctx.mapping.model)}With${capitalize(ctx.firstScalar.name)}Only = await ${ctx.method}({
  select: { ${ctx.firstScalar.name}: true },
  data: [
    // ... provide data here
  ]
})`
        : ''

      return `Create many ${ctx.plural} and returns the data saved in the database.
@param {${getModelArgName(ctx.model.name, ctx.action)}} args - Arguments to create many ${ctx.plural}.
@example
// Create many ${ctx.plural}
const ${uncapitalize(ctx.mapping.model)} = await ${ctx.method}({
  data: [
    // ... provide data here
  ]
})
${onlySelect}
${undefinedNote}
`
    },
    fields: {
      data: (singular, plural) => `The data used to create many ${plural}.`,
    },
  },
  findUnique: {
    body: (ctx) =>
      `Find zero or one ${ctx.singular} that matches the filter.
@param {${getModelArgName(ctx.model.name, ctx.action)}} args - Arguments to find a ${ctx.singular}
@example
// Get one ${ctx.singular}
const ${uncapitalize(ctx.mapping.model)} = await ${ctx.method}({
  where: {
    // ... provide filter here
  }
})`,
    fields: {
      where: (singular) => `Filter, which ${singular} to fetch.`,
    },
  },
  findUniqueOrThrow: {
    body: (ctx) =>
      `Find one ${ctx.singular} that matches the filter or throw an error with \`error.code='P2025'\`
if no matches were found.
@param {${getModelArgName(ctx.model.name, ctx.action)}} args - Arguments to find a ${ctx.singular}
@example
// Get one ${ctx.singular}
const ${uncapitalize(ctx.mapping.model)} = await ${ctx.method}({
  where: {
    // ... provide filter here
  }
})`,
    fields: {
      where: (singular) => `Filter, which ${singular} to fetch.`,
    },
  },
  findFirst: {
    body: (ctx) =>
      `Find the first ${ctx.singular} that matches the filter.
${undefinedNote}
@param {${getModelArgName(ctx.model.name, ctx.action)}} args - Arguments to find a ${ctx.singular}
@example
// Get one ${ctx.singular}
const ${uncapitalize(ctx.mapping.model)} = await ${ctx.method}({
  where: {
    // ... provide filter here
  }
})`,
    fields: {
      where: (singular) => `Filter, which ${singular} to fetch.`,
      orderBy: JSDocFields.orderBy,
      cursor: (singular, plural) => addLinkToDocs(`Sets the position for searching for ${plural}.`, 'cursor'),
      take: JSDocFields.take,
      skip: JSDocFields.skip,
      distinct: JSDocFields.distinct,
    },
  },
  findFirstOrThrow: {
    body: (ctx) =>
      `Find the first ${ctx.singular} that matches the filter or
throw \`PrismaKnownClientError\` with \`P2025\` code if no matches were found.
${undefinedNote}
@param {${getModelArgName(ctx.model.name, ctx.action)}} args - Arguments to find a ${ctx.singular}
@example
// Get one ${ctx.singular}
const ${uncapitalize(ctx.mapping.model)} = await ${ctx.method}({
  where: {
    // ... provide filter here
  }
})`,
    fields: {
      where: (singular) => `Filter, which ${singular} to fetch.`,
      orderBy: JSDocFields.orderBy,
      cursor: (singular, plural) => addLinkToDocs(`Sets the position for searching for ${plural}.`, 'cursor'),
      take: JSDocFields.take,
      skip: JSDocFields.skip,
      distinct: JSDocFields.distinct,
    },
  },
  findMany: {
    body: (ctx) => {
      const onlySelect = ctx.firstScalar
        ? `\n// Only select the \`${ctx.firstScalar.name}\`
const ${uncapitalize(ctx.mapping.model)}With${capitalize(ctx.firstScalar.name)}Only = await ${ctx.method}({ select: { ${
            ctx.firstScalar.name
          }: true } })`
        : ''

      return `Find zero or more ${ctx.plural} that matches the filter.
${undefinedNote}
@param {${getModelArgName(ctx.model.name, ctx.action)}} args - Arguments to filter and select certain fields only.
@example
// Get all ${ctx.plural}
const ${ctx.mapping.plural} = await ${ctx.method}()

// Get first 10 ${ctx.plural}
const ${ctx.mapping.plural} = await ${ctx.method}({ take: 10 })
${onlySelect}
`
    },
    fields: {
      where: (singular, plural) => `Filter, which ${plural} to fetch.`,
      orderBy: JSDocFields.orderBy,
      skip: JSDocFields.skip,
      cursor: (singular, plural) => addLinkToDocs(`Sets the position for listing ${plural}.`, 'cursor'),
      take: JSDocFields.take,
      distinct: JSDocFields.distinct,
    },
  },
  update: {
    body: (ctx) =>
      `Update one ${ctx.singular}.
@param {${getModelArgName(ctx.model.name, ctx.action)}} args - Arguments to update one ${ctx.singular}.
@example
// Update one ${ctx.singular}
const ${uncapitalize(ctx.mapping.model)} = await ${ctx.method}({
  where: {
    // ... provide filter here
  },
  data: {
    // ... provide data here
  }
})
`,
    fields: {
      data: (singular) => `The data needed to update a ${singular}.`,
      where: (singular) => `Choose, which ${singular} to update.`,
    },
  },
  upsert: {
    body: (ctx) =>
      `Create or update one ${ctx.singular}.
@param {${getModelArgName(ctx.model.name, ctx.action)}} args - Arguments to update or create a ${ctx.singular}.
@example
// Update or create a ${ctx.singular}
const ${uncapitalize(ctx.mapping.model)} = await ${ctx.method}({
  create: {
    // ... data to create a ${ctx.singular}
  },
  update: {
    // ... in case it already exists, update
  },
  where: {
    // ... the filter for the ${ctx.singular} we want to update
  }
})`,
    fields: {
      where: (singular) => `The filter to search for the ${singular} to update in case it exists.`,
      create: (singular) =>
        `In case the ${singular} found by the \`where\` argument doesn't exist, create a new ${singular} with this data.`,
      update: (singular) =>
        `In case the ${singular} was found with the provided \`where\` argument, update it with this data.`,
    },
  },
  delete: {
    body: (ctx) =>
      `Delete a ${ctx.singular}.
@param {${getModelArgName(ctx.model.name, ctx.action)}} args - Arguments to delete one ${ctx.singular}.
@example
// Delete one ${ctx.singular}
const ${ctx.singular} = await ${ctx.method}({
  where: {
    // ... filter to delete one ${ctx.singular}
  }
})
`,
    fields: {
      where: (singular) => `Filter which ${singular} to delete.`,
    },
  },
  aggregate: {
    body: (ctx) =>
      `Allows you to perform aggregations operations on a ${ctx.singular}.
${undefinedNote}
@param {${getModelArgName(
        ctx.model.name,
        ctx.action,
      )}} args - Select which aggregations you would like to apply and on what fields.
@example
// Ordered by age ascending
// Where email contains prisma.io
// Limited to the 10 users
const aggregations = await prisma.user.aggregate({
  _avg: {
    age: true,
  },
  where: {
    email: {
      contains: "prisma.io",
    },
  },
  orderBy: {
    age: "asc",
  },
  take: 10,
})`,
    fields: {
      where: (singular) => `Filter which ${singular} to aggregate.`,
      orderBy: JSDocFields.orderBy,
      cursor: () => addLinkToDocs(`Sets the start position`, 'cursor'),
      take: JSDocFields.take,
      skip: JSDocFields.skip,
      _count: JSDocFields._count,
      _avg: JSDocFields._avg,
      _sum: JSDocFields._sum,
      _min: JSDocFields._min,
      _max: JSDocFields._max,
      count: JSDocFields.count,
      avg: JSDocFields.avg,
      sum: JSDocFields.sum,
      min: JSDocFields.min,
      max: JSDocFields.max,
    },
  },
  count: {
    body: (ctx) =>
      `Count the number of ${ctx.plural}.
${undefinedNote}
@param {${getModelArgName(ctx.model.name, ctx.action)}} args - Arguments to filter ${ctx.plural} to count.
@example
// Count the number of ${ctx.plural}
const count = await ${ctx.method}({
  where: {
    // ... the filter for the ${ctx.plural} we want to count
  }
})`,
    fields: {},
  },
  updateMany: {
    body: (ctx) =>
      `Update zero or more ${ctx.plural}.
${undefinedNote}
@param {${getModelArgName(ctx.model.name, ctx.action)}} args - Arguments to update one or more rows.
@example
// Update many ${ctx.plural}
const ${uncapitalize(ctx.mapping.model)} = await ${ctx.method}({
  where: {
    // ... provide filter here
  },
  data: {
    // ... provide data here
  }
})
`,
    fields: {
      data: (singular, plural) => `The data used to update ${plural}.`,
      where: (singular, plural) => `Filter which ${plural} to update`,
      limit: (singular, plural) => `Limit how many ${plural} to update.`,
    },
  },
  updateManyAndReturn: {
    body: (ctx) => {
      const onlySelect = ctx.firstScalar
        ? `\n// Update zero or more ${ctx.plural} and only return the \`${ctx.firstScalar.name}\`
const ${uncapitalize(ctx.mapping.model)}With${capitalize(ctx.firstScalar.name)}Only = await ${ctx.method}({
  select: { ${ctx.firstScalar.name}: true },
  where: {
    // ... provide filter here
  },
  data: [
    // ... provide data here
  ]
})`
        : ''

      return `Update zero or more ${ctx.plural} and returns the data updated in the database.
@param {${getModelArgName(ctx.model.name, ctx.action)}} args - Arguments to update many ${ctx.plural}.
@example
// Update many ${ctx.plural}
const ${uncapitalize(ctx.mapping.model)} = await ${ctx.method}({
  where: {
    // ... provide filter here
  },
  data: [
    // ... provide data here
  ]
})
${onlySelect}
${undefinedNote}
`
    },
    fields: {
      data: (singular, plural) => `The data used to update ${plural}.`,
      where: (singular, plural) => `Filter which ${plural} to update`,
      limit: (singular, plural) => `Limit how many ${plural} to update.`,
    },
  },
  deleteMany: {
    body: (ctx) =>
      `Delete zero or more ${ctx.plural}.
@param {${getModelArgName(ctx.model.name, ctx.action)}} args - Arguments to filter ${ctx.plural} to delete.
@example
// Delete a few ${ctx.plural}
const { count } = await ${ctx.method}({
  where: {
    // ... provide filter here
  }
})
`,
    fields: {
      where: (singular, plural) => `Filter which ${plural} to delete`,
      limit: (singular, plural) => `Limit how many ${plural} to delete.`,
    },
  },
  aggregateRaw: {
    body: (ctx) =>
      `Perform aggregation operations on a ${ctx.singular}.
@param {${getModelArgName(ctx.model.name, ctx.action)}} args - Select which aggregations you would like to apply.
@example
const ${uncapitalize(ctx.mapping.model)} = await ${ctx.method}({
  pipeline: [
    { $match: { status: "registered" } },
    { $group: { _id: "$country", total: { $sum: 1 } } }
  ]
})`,
    fields: {
      pipeline: () =>
        'An array of aggregation stages to process and transform the document stream via the aggregation pipeline. ${@link https://docs.mongodb.com/manual/reference/operator/aggregation-pipeline MongoDB Docs}.',
      options: () =>
        'Additional options to pass to the `aggregate` command ${@link https://docs.mongodb.com/manual/reference/command/aggregate/#command-fields MongoDB Docs}.',
    },
  },
  findRaw: {
    body: (ctx) =>
      `Find zero or more ${ctx.plural} that matches the filter.
@param {${getModelArgName(ctx.model.name, ctx.action)}} args - Select which filters you would like to apply.
@example
const ${uncapitalize(ctx.mapping.model)} = await ${ctx.method}({
  filter: { age: { $gt: 25 } }
})`,
    fields: {
      filter: () =>
        'The query predicate filter. If unspecified, then all documents in the collection will match the predicate. ${@link https://docs.mongodb.com/manual/reference/operator/query MongoDB Docs}.',
      options: () =>
        'Additional options to pass to the `find` command ${@link https://docs.mongodb.com/manual/reference/command/find/#command-fields MongoDB Docs}.',
    },
  },
}
