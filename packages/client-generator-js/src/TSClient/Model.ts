import { capitalize } from '@prisma/client-common'
import * as DMMF from '@prisma/dmmf'
import * as ts from '@prisma/ts-builders'
import indent from 'indent-string'
import { klona } from 'klona'

import type { DMMFHelper } from '../dmmf'
import {
  extArgsParam,
  getAggregateArgsName,
  getAggregateGetName,
  getAggregateInputType,
  getAggregateName,
  getAvgAggregateName,
  getCountAggregateInputName,
  getCountAggregateOutputName,
  getCreateManyAndReturnOutputType,
  getFieldArgName,
  getFieldRefsTypeName,
  getGroupByArgsName,
  getGroupByName,
  getGroupByPayloadName,
  getIncludeCreateManyAndReturnName,
  getIncludeUpdateManyAndReturnName,
  getMaxAggregateName,
  getMinAggregateName,
  getModelArgName,
  getModelFieldArgsName,
  getPayloadName,
  getSelectCreateManyAndReturnName,
  getSelectUpdateManyAndReturnName,
  getSumAggregateName,
  getUpdateManyAndReturnOutputType,
} from '../utils'
import { InputField } from './../TSClient'
import { ArgsTypeBuilder } from './Args'
import { TAB_SIZE } from './constants'
import type { Generable } from './Generable'
import { GenerateContext } from './GenerateContext'
import { getArgFieldJSDoc, getMethodJSDoc, getMethodJSDocBody, wrapComment } from './helpers'
import { InputType } from './Input'
import { ModelFieldRefs } from './ModelFieldRefs'
import { buildOutputType } from './Output'
import { buildModelPayload } from './Payload'
import { buildIncludeType, buildOmitType, buildScalarSelectType, buildSelectType } from './SelectIncludeOmit'
import { getModelActions } from './utils/getModelActions'
import * as tsx from './utils/type-builders'

export class Model implements Generable {
  protected type: DMMF.OutputType
  protected createManyAndReturnType: undefined | DMMF.OutputType
  protected updateManyAndReturnType: undefined | DMMF.OutputType
  protected mapping?: DMMF.ModelMapping
  private dmmf: DMMFHelper
  constructor(
    protected readonly model: DMMF.Model,
    protected readonly context: GenerateContext,
  ) {
    this.dmmf = context.dmmf
    this.type = this.context.dmmf.outputTypeMap.model[model.name]

    this.createManyAndReturnType = this.context.dmmf.outputTypeMap.model[getCreateManyAndReturnOutputType(model.name)]
    this.updateManyAndReturnType = this.context.dmmf.outputTypeMap.model[getUpdateManyAndReturnOutputType(model.name)]
    this.mapping = this.context.dmmf.mappings.modelOperations.find((m) => m.model === model.name)!
  }

  protected get argsTypes(): ts.Export<ts.TypeDeclaration>[] {
    const argsTypes: ts.Export<ts.TypeDeclaration>[] = []
    for (const action of Object.keys(DMMF.ModelAction)) {
      const fieldName = this.rootFieldNameForAction(action as DMMF.ModelAction)
      if (!fieldName) {
        continue
      }
      const field = this.dmmf.rootFieldMap[fieldName]
      if (!field) {
        throw new Error(`Oops this must not happen. Could not find field ${fieldName} on either Query or Mutation`)
      }

      if (
        action === 'updateMany' ||
        action === 'deleteMany' ||
        action === 'createMany' ||
        action === 'findRaw' ||
        action === 'aggregateRaw'
      ) {
        argsTypes.push(
          new ArgsTypeBuilder(this.type, this.context, action as DMMF.ModelAction)
            .addSchemaArgs(field.args)
            .createExport(),
        )
      } else if (action === 'createManyAndReturn') {
        const args = new ArgsTypeBuilder(this.type, this.context, action as DMMF.ModelAction)
          .addSelectArg(getSelectCreateManyAndReturnName(this.type.name))
          .addOmitArg()
          .addSchemaArgs(field.args)

        if (this.createManyAndReturnType) {
          args.addIncludeArgIfHasRelations(
            getIncludeCreateManyAndReturnName(this.model.name),
            this.createManyAndReturnType,
          )
        }
        argsTypes.push(args.createExport())
      } else if (action === 'updateManyAndReturn') {
        const args = new ArgsTypeBuilder(this.type, this.context, action as DMMF.ModelAction)
          .addSelectArg(getSelectUpdateManyAndReturnName(this.type.name))
          .addOmitArg()
          .addSchemaArgs(field.args)

        if (this.updateManyAndReturnType) {
          args.addIncludeArgIfHasRelations(
            getIncludeUpdateManyAndReturnName(this.model.name),
            this.updateManyAndReturnType,
          )
        }
        argsTypes.push(args.createExport())
      } else if (action !== 'groupBy' && action !== 'aggregate') {
        argsTypes.push(
          new ArgsTypeBuilder(this.type, this.context, action as DMMF.ModelAction)
            .addSelectArg()
            .addOmitArg()
            .addIncludeArgIfHasRelations()
            .addSchemaArgs(field.args)
            .createExport(),
        )
      }
    }

    for (const field of this.type.fields) {
      if (!field.args.length) {
        continue
      }
      const fieldOutput = this.dmmf.resolveOutputObjectType(field.outputType)
      if (!fieldOutput) {
        continue
      }
      argsTypes.push(
        new ArgsTypeBuilder(fieldOutput, this.context)
          .addSelectArg()
          .addOmitArg()
          .addIncludeArgIfHasRelations()
          .addSchemaArgs(field.args)
          .setGeneratedName(getModelFieldArgsName(field, this.model.name))
          .setComment(`${this.model.name}.${field.name}`)
          .createExport(),
      )
    }

    argsTypes.push(
      new ArgsTypeBuilder(this.type, this.context)
        .addSelectArg()
        .addOmitArg()
        .addIncludeArgIfHasRelations()
        .createExport(),
    )

    return argsTypes
  }

  private rootFieldNameForAction(action: DMMF.ModelAction) {
    return this.mapping?.[action]
  }

  private getGroupByTypes() {
    const { model, mapping } = this

    const groupByType = this.dmmf.outputTypeMap.prisma[getGroupByName(model.name)]
    if (!groupByType) {
      throw new Error(`Could not get group by type for model ${model.name}`)
    }

    const groupByRootField = this.dmmf.rootFieldMap[mapping!.groupBy!]
    if (!groupByRootField) {
      throw new Error(`Could not find groupBy root field for model ${model.name}. Mapping: ${mapping?.groupBy}`)
    }

    const groupByArgsName = getGroupByArgsName(model.name)

    return `


export type ${groupByArgsName}<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
${indent(
  groupByRootField.args
    .map((arg) => {
      const updatedArg = { ...arg, comment: getArgFieldJSDoc(this.type, DMMF.ModelAction.groupBy, arg) }
      return new InputField(updatedArg, this.context).toTS()
    })
    .concat(
      groupByType.fields
        .filter((f) => f.outputType.location === 'outputObjectTypes')
        .map((f) => {
          if (f.outputType.location === 'outputObjectTypes') {
            return `${f.name}?: ${getAggregateInputType(f.outputType.type)}${f.name === '_count' ? ' | true' : ''}`
          }

          // to make TS happy, but can't happen, as we filter for outputObjectTypes
          return ''
        }),
    )
    .join('\n'),
  TAB_SIZE,
)}
}

${ts.stringify(buildOutputType(groupByType))}

type ${getGroupByPayloadName(model.name)}<T extends ${groupByArgsName}> = Prisma.PrismaPromise<
  Array<
    PickEnumerable<${groupByType.name}, T['by']> &
      {
        [P in ((keyof T) & (keyof ${groupByType.name}))]: P extends '_count'
          ? T[P] extends boolean
            ? number
            : GetScalarType<T[P], ${groupByType.name}[P]>
          : GetScalarType<T[P], ${groupByType.name}[P]>
      }
    >
  >
`
  }
  private getAggregationTypes() {
    const { model, mapping } = this
    let aggregateType = this.dmmf.outputTypeMap.prisma[getAggregateName(model.name)]
    if (!aggregateType) {
      throw new Error(`Could not get aggregate type "${getAggregateName(model.name)}" for "${model.name}"`)
    }
    aggregateType = klona(aggregateType)

    const aggregateRootField = this.dmmf.rootFieldMap[mapping!.aggregate!]
    if (!aggregateRootField) {
      throw new Error(`Could not find aggregate root field for model ${model.name}. Mapping: ${mapping?.aggregate}`)
    }

    const aggregateTypes = [aggregateType]

    const avgType = this.dmmf.outputTypeMap.prisma[getAvgAggregateName(model.name)]
    const sumType = this.dmmf.outputTypeMap.prisma[getSumAggregateName(model.name)]
    const minType = this.dmmf.outputTypeMap.prisma[getMinAggregateName(model.name)]
    const maxType = this.dmmf.outputTypeMap.prisma[getMaxAggregateName(model.name)]
    const countType = this.dmmf.outputTypeMap.prisma[getCountAggregateOutputName(model.name)]

    if (avgType) {
      aggregateTypes.push(avgType)
    }
    if (sumType) {
      aggregateTypes.push(sumType)
    }
    if (minType) {
      aggregateTypes.push(minType)
    }
    if (maxType) {
      aggregateTypes.push(maxType)
    }
    if (countType) {
      aggregateTypes.push(countType)
    }

    const aggregateArgsName = getAggregateArgsName(model.name)

    const aggregateName = getAggregateName(model.name)

    return `${aggregateTypes
      .map(buildOutputType)
      .map((type) => ts.stringify(type))
      .join('\n\n')}

${
  aggregateTypes.length > 1
    ? aggregateTypes
        .slice(1)
        .map((type) => {
          const newType: DMMF.InputType = {
            name: getAggregateInputType(type.name),
            constraints: {
              maxNumFields: null,
              minNumFields: null,
            },
            fields: type.fields.map((field) => ({
              ...field,
              name: field.name,
              isNullable: false,
              isRequired: false,
              isParameterizable: false,
              inputTypes: [
                {
                  isList: false,
                  location: 'scalar',
                  type: 'true',
                },
              ],
            })),
          }
          return new InputType(newType, this.context).toTS()
        })
        .join('\n')
    : ''
}

export type ${aggregateArgsName}<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
${indent(
  aggregateRootField.args
    .map((arg) => {
      const updatedArg = { ...arg, comment: getArgFieldJSDoc(this.type, DMMF.ModelAction.aggregate, arg) }
      return new InputField(updatedArg, this.context).toTS()
    })
    .concat(
      aggregateType.fields.map((f) => {
        let data = ''
        const comment = getArgFieldJSDoc(this.type, DMMF.ModelAction.aggregate, f.name)
        data += comment ? wrapComment(comment) + '\n' : ''
        if (f.name === '_count' || f.name === 'count') {
          data += `${f.name}?: true | ${getCountAggregateInputName(model.name)}`
        } else {
          data += `${f.name}?: ${getAggregateInputType(f.outputType.type)}`
        }
        return data
      }),
    )
    .join('\n'),
  TAB_SIZE,
)}
}

export type ${getAggregateGetName(model.name)}<T extends ${getAggregateArgsName(model.name)}> = {
      [P in keyof T & keyof ${aggregateName}]: P extends '_count' | 'count'
    ? T[P] extends true
      ? number
      : GetScalarType<T[P], ${aggregateName}[P]>
    : GetScalarType<T[P], ${aggregateName}[P]>
}`
  }
  public toTSWithoutNamespace(): string {
    const { model } = this

    const docLines = model.documentation ?? ''
    const modelLine = `Model ${model.name}\n`
    const docs = `${modelLine}${docLines}`

    const modelTypeExport = ts
      .moduleExport(
        ts.typeDeclaration(
          model.name,
          ts.namedType(`$Result.DefaultSelection`).addGenericArgument(ts.namedType(getPayloadName(model.name))),
        ),
      )
      .setDocComment(ts.docComment(docs))

    return ts.stringify(modelTypeExport)
  }
  public toTS(): string {
    const { model } = this
    const isComposite = this.dmmf.isComposite(model.name)

    const omitType = ts.stringify(
      buildOmitType({ modelName: this.model.name, context: this.context, fields: this.type.fields }),
      {
        newLine: 'leading',
      },
    )

    const hasRelationField = model.fields.some((f) => f.kind === 'object')
    const includeType = hasRelationField
      ? ts.stringify(
          buildIncludeType({ modelName: this.model.name, context: this.context, fields: this.type.fields }),
          {
            newLine: 'leading',
          },
        )
      : ''

    const createManyAndReturnIncludeType =
      hasRelationField && this.createManyAndReturnType
        ? ts.stringify(
            buildIncludeType({
              typeName: getIncludeCreateManyAndReturnName(this.model.name),
              modelName: this.model.name,
              context: this.context,
              fields: this.createManyAndReturnType.fields,
            }),
            {
              newLine: 'leading',
            },
          )
        : ''

    const updateManyAndReturnIncludeType =
      hasRelationField && this.updateManyAndReturnType
        ? ts.stringify(
            buildIncludeType({
              typeName: getIncludeUpdateManyAndReturnName(this.model.name),
              modelName: this.model.name,
              context: this.context,
              fields: this.updateManyAndReturnType.fields,
            }),
            {
              newLine: 'leading',
            },
          )
        : ''

    return `
/**
 * Model ${model.name}
 */

${!isComposite ? this.getAggregationTypes() : ''}

${!isComposite ? this.getGroupByTypes() : ''}

${ts.stringify(buildSelectType({ modelName: this.model.name, fields: this.type.fields, context: this.context }))}
${
  this.createManyAndReturnType
    ? ts.stringify(
        buildSelectType({
          modelName: this.model.name,
          fields: this.createManyAndReturnType.fields,
          context: this.context,
          typeName: getSelectCreateManyAndReturnName(this.model.name),
        }),
        { newLine: 'leading' },
      )
    : ''
}
${
  this.updateManyAndReturnType
    ? ts.stringify(
        buildSelectType({
          modelName: this.model.name,
          fields: this.updateManyAndReturnType.fields,
          context: this.context,
          typeName: getSelectUpdateManyAndReturnName(this.model.name),
        }),
        { newLine: 'leading' },
      )
    : ''
}
${ts.stringify(buildScalarSelectType({ modelName: this.model.name, fields: this.type.fields, context: this.context }), {
  newLine: 'leading',
})}
${omitType}${includeType}${createManyAndReturnIncludeType}${updateManyAndReturnIncludeType}

${ts.stringify(buildModelPayload(this.model, this.context), { newLine: 'none' })}

type ${model.name}GetPayload<S extends boolean | null | undefined | ${getModelArgName(
      model.name,
    )}> = $Result.GetResult<${getPayloadName(model.name)}, S>

${isComposite ? '' : new ModelDelegate(this.type, this.context).toTS()}

${new ModelFieldRefs(this.type).toTS()}

// Custom InputTypes
${this.argsTypes.map((type) => ts.stringify(type)).join('\n\n')}
`
  }
}
export class ModelDelegate implements Generable {
  constructor(
    protected readonly outputType: DMMF.OutputType,
    protected readonly context: GenerateContext,
  ) {}

  /**
   * Returns all available non-aggregate or group actions
   * Includes both dmmf and client-only actions
   *
   * @param availableActions
   * @returns
   */
  private getNonAggregateActions(availableActions: DMMF.ModelAction[]): DMMF.ModelAction[] {
    const actions = availableActions.filter(
      (key) => key !== DMMF.ModelAction.aggregate && key !== DMMF.ModelAction.groupBy && key !== DMMF.ModelAction.count,
    )

    return actions
  }

  public toTS(): string {
    const { name } = this.outputType
    const { dmmf } = this.context

    const mapping = dmmf.mappingsMap[name] ?? { model: name, plural: `${name}s` }
    const modelOrType = dmmf.typeAndModelMap[name]

    const availableActions = getModelActions(dmmf, name)
    const nonAggregateActions = this.getNonAggregateActions(availableActions)
    const groupByArgsName = getGroupByArgsName(name)
    const countArgsName = getModelArgName(name, DMMF.ModelAction.count)

    const genericDelegateParams = [extArgsParam, ts.genericParameter('GlobalOmitOptions').default(ts.objectType())]

    const excludedArgsForCount = ['select', 'include', 'distinct', 'omit']
    if (this.context.isPreviewFeatureOn('relationJoins')) {
      excludedArgsForCount.push('relationLoadStrategy')
    }

    const excludedArgsForCountType = excludedArgsForCount.map((name) => `'${name}'`).join(' | ')

    return `\
${
  availableActions.includes(DMMF.ModelAction.aggregate)
    ? `type ${countArgsName}<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
  Omit<${getModelArgName(name, DMMF.ModelAction.findMany)}, ${excludedArgsForCountType}> & {
    select?: ${getCountAggregateInputName(name)} | true
  }
`
    : ''
}
export interface ${name}Delegate<${genericDelegateParams.map((param) => ts.stringify(param)).join(', ')}> {
${indent(`[K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['${name}'], meta: { name: '${name}' } }`, TAB_SIZE)}
${nonAggregateActions
  .map((action) => {
    const method = buildModelDelegateMethod(name, action, this.context)
    return ts.stringify(method, { indentLevel: 1, newLine: 'trailing' })
  })
  .join('\n')}

${
  availableActions.includes(DMMF.ModelAction.aggregate)
    ? `${indent(getMethodJSDoc(DMMF.ModelAction.count, mapping, modelOrType), TAB_SIZE)}
  count<T extends ${countArgsName}>(
    args?: Subset<T, ${countArgsName}>,
  ): Prisma.PrismaPromise<
    T extends $Utils.Record<'select', any>
      ? T['select'] extends true
        ? number
        : GetScalarType<T['select'], ${getCountAggregateOutputName(name)}>
      : number
  >
`
    : ''
}
${
  availableActions.includes(DMMF.ModelAction.aggregate)
    ? `${indent(getMethodJSDoc(DMMF.ModelAction.aggregate, mapping, modelOrType), TAB_SIZE)}
  aggregate<T extends ${getAggregateArgsName(name)}>(args: Subset<T, ${getAggregateArgsName(
    name,
  )}>): Prisma.PrismaPromise<${getAggregateGetName(name)}<T>>
`
    : ''
}
${
  availableActions.includes(DMMF.ModelAction.groupBy)
    ? `${indent(getMethodJSDoc(DMMF.ModelAction.groupBy, mapping, modelOrType), TAB_SIZE)}
  groupBy<
    T extends ${groupByArgsName},
    HasSelectOrTake extends Or<
      Extends<'skip', Keys<T>>,
      Extends<'take', Keys<T>>
    >,
    OrderByArg extends True extends HasSelectOrTake
      ? { orderBy: ${groupByArgsName}['orderBy'] }
      : { orderBy?: ${groupByArgsName}['orderBy'] },
    OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
    ByFields extends MaybeTupleToUnion<T['by']>,
    ByValid extends Has<ByFields, OrderFields>,
    HavingFields extends GetHavingFields<T['having']>,
    HavingValid extends Has<ByFields, HavingFields>,
    ByEmpty extends T['by'] extends never[] ? True : False,
    InputErrors extends ByEmpty extends True
    ? \`Error: "by" must not be empty.\`
    : HavingValid extends False
    ? {
        [P in HavingFields]: P extends ByFields
          ? never
          : P extends string
          ? \`Error: Field "$\{P}" used in "having" needs to be provided in "by".\`
          : [
              Error,
              'Field ',
              P,
              \` in "having" needs to be provided in "by"\`,
            ]
      }[HavingFields]
    : 'take' extends Keys<T>
    ? 'orderBy' extends Keys<T>
      ? ByValid extends True
        ? {}
        : {
            [P in OrderFields]: P extends ByFields
              ? never
              : \`Error: Field "$\{P}" in "orderBy" needs to be provided in "by"\`
          }[OrderFields]
      : 'Error: If you provide "take", you also need to provide "orderBy"'
    : 'skip' extends Keys<T>
    ? 'orderBy' extends Keys<T>
      ? ByValid extends True
        ? {}
        : {
            [P in OrderFields]: P extends ByFields
              ? never
              : \`Error: Field "$\{P}" in "orderBy" needs to be provided in "by"\`
          }[OrderFields]
      : 'Error: If you provide "skip", you also need to provide "orderBy"'
    : ByValid extends True
    ? {}
    : {
        [P in OrderFields]: P extends ByFields
          ? never
          : \`Error: Field "$\{P}" in "orderBy" needs to be provided in "by"\`
      }[OrderFields]
  >(args: SubsetIntersection<T, ${groupByArgsName}, OrderByArg> & InputErrors): {} extends InputErrors ? ${getGroupByPayloadName(
    name,
  )}<T> : Prisma.PrismaPromise<InputErrors>`
    : ''
}
/**
 * Fields of the ${name} model
 */
readonly fields: ${getFieldRefsTypeName(name)};
}

${ts.stringify(buildFluentWrapperDefinition(name, this.outputType, this.context))}
`
  }
}

function buildModelDelegateMethod(modelName: string, actionName: DMMF.ModelAction, context: GenerateContext) {
  const mapping = context.dmmf.mappingsMap[modelName] ?? { model: modelName, plural: `${modelName}s` }
  const modelOrType = context.dmmf.typeAndModelMap[modelName]
  const dependencyValidators = getNonAggregateMethodDependencyValidations(mapping, actionName, context)

  const method = ts
    .method(actionName)
    .setDocComment(ts.docComment(getMethodJSDocBody(actionName, mapping, modelOrType)))
    .addParameter(getNonAggregateMethodArgs(modelName, actionName, dependencyValidators))
    .setReturnType(getReturnType({ modelName, actionName }))

  const generic = getNonAggregateMethodGenericParam(modelName, actionName)
  if (generic) {
    method.addGenericParameter(generic)
  }

  for (const validator of dependencyValidators) {
    method.addGenericParameter(validator)
  }

  return method
}

function getNonAggregateMethodArgs(
  modelName: string,
  actionName: DMMF.ModelAction,
  dependencyValidators: ts.GenericParameter[],
) {
  const makeParameter = (type: ts.TypeBuilder) => {
    if (dependencyValidators.length > 0) {
      type = ts.intersectionType([type, ...dependencyValidators.map((validator) => ts.namedType(validator.name))])
    }
    return ts.parameter('args', type)
  }

  if (actionName === DMMF.ModelAction.count) {
    const type = ts.omit(
      ts.namedType(getModelArgName(modelName, DMMF.ModelAction.findMany)),
      ts
        .unionType(ts.stringLiteral('select'))
        .addVariant(ts.stringLiteral('include'))
        .addVariant(ts.stringLiteral('distinct')),
    )
    return makeParameter(type).optional()
  }
  if (actionName === DMMF.ModelAction.findRaw || actionName === DMMF.ModelAction.aggregateRaw) {
    return makeParameter(ts.namedType(getModelArgName(modelName, actionName))).optional()
  }

  const type = ts
    .namedType('SelectSubset')
    .addGenericArgument(ts.namedType('T'))
    .addGenericArgument(
      ts.namedType(getModelArgName(modelName, actionName)).addGenericArgument(extArgsParam.toArgument()),
    )
  const param = makeParameter(type)

  if (
    actionName === DMMF.ModelAction.findMany ||
    actionName === DMMF.ModelAction.findFirst ||
    actionName === DMMF.ModelAction.deleteMany ||
    actionName === DMMF.ModelAction.createMany ||
    actionName === DMMF.ModelAction.createManyAndReturn ||
    actionName === DMMF.ModelAction.findFirstOrThrow
  ) {
    param.optional()
  }

  return param
}

function getNonAggregateMethodGenericParam(modelName: string, actionName: DMMF.ModelAction) {
  if (
    actionName === DMMF.ModelAction.count ||
    actionName === DMMF.ModelAction.findRaw ||
    actionName === DMMF.ModelAction.aggregateRaw
  ) {
    return null
  }
  const arg = ts.genericParameter('T')
  if (actionName === DMMF.ModelAction.aggregate) {
    return arg.extends(ts.namedType(getAggregateArgsName(modelName)))
  }
  return arg.extends(ts.namedType(getModelArgName(modelName, actionName)))
}

function getNonAggregateMethodDependencyValidations(
  modelMapping: DMMF.ModelMapping,
  actionName: DMMF.ModelAction,
  context: GenerateContext,
): ts.GenericParameter[] {
  const outputFieldName = modelMapping[actionName]
  if (!outputFieldName) {
    throw new Error(`Missing mapping for ${modelMapping.model}.${actionName}`)
  }

  const outputField =
    context.dmmf.outputTypeMap.prisma['Query'].fields.find((f) => f.name === outputFieldName) ??
    context.dmmf.outputTypeMap.prisma['Mutation'].fields.find((f) => f.name === outputFieldName)

  if (!outputField) {
    throw new Error(`Can't find output field ${outputFieldName} in the schema`)
  }

  const validators: ts.GenericParameter[] = []

  for (const args of outputField.args) {
    if (args.requiresOtherFields === undefined) {
      continue
    }

    const objectType = ts.objectType()

    for (const reqArg of args.requiresOtherFields) {
      objectType.add(ts.property(reqArg, ts.objectType()))
    }

    validators.push(
      ts
        .genericParameter(`${capitalize(args.name)}DependenciesValidator`)
        .extends(
          ts
            .conditionalType()
            .check(ts.stringLiteral(args.name))
            .extends(ts.namedType('Prisma.Keys<T>'))
            .then(objectType)
            .else(ts.objectType()),
        ),
    )
  }

  return validators
}

type GetReturnTypeOptions = {
  modelName: string
  actionName: DMMF.ModelAction
  isChaining?: boolean
  isNullable?: boolean
}

/**
 * Get the complicated extract output
 * @param name Model name
 * @param actionName action name
 */
export function getReturnType({
  modelName,
  actionName,
  isChaining = false,
  isNullable = false,
}: GetReturnTypeOptions): ts.TypeBuilder {
  if (actionName === DMMF.ModelAction.count) {
    return tsx.promise(ts.numberType)
  }
  if (actionName === DMMF.ModelAction.aggregate) {
    return tsx.promise(ts.namedType(getAggregateGetName(modelName)).addGenericArgument(ts.namedType('T')))
  }

  if (actionName === DMMF.ModelAction.findRaw || actionName === DMMF.ModelAction.aggregateRaw) {
    return tsx.prismaPromise(ts.namedType('JsonObject'))
  }

  if (
    actionName === DMMF.ModelAction.deleteMany ||
    actionName === DMMF.ModelAction.updateMany ||
    actionName === DMMF.ModelAction.createMany
  ) {
    return tsx.prismaPromise(ts.namedType('BatchPayload'))
  }

  const isList =
    actionName === DMMF.ModelAction.findMany ||
    actionName === DMMF.ModelAction.createManyAndReturn ||
    actionName === DMMF.ModelAction.updateManyAndReturn

  /**
   * Important: We handle findMany or isList special, as we don't want chaining from there
   */
  if (isList) {
    let result: ts.TypeBuilder = getResultType(modelName, actionName)
    if (isChaining) {
      result = ts.unionType(result).addVariant(ts.namedType('Null'))
    }

    return tsx.prismaPromise(result)
  }

  if (isChaining && actionName === DMMF.ModelAction.findUniqueOrThrow) {
    const nullType = isNullable ? ts.nullType : ts.namedType('Null')
    const result = ts.unionType<ts.TypeBuilder>(getResultType(modelName, actionName)).addVariant(nullType)
    return getFluentWrapper(modelName, result, nullType)
  }

  if (actionName === DMMF.ModelAction.findFirst || actionName === DMMF.ModelAction.findUnique) {
    const result = ts.unionType<ts.TypeBuilder>(getResultType(modelName, actionName)).addVariant(ts.nullType)
    return getFluentWrapper(modelName, result, ts.nullType)
  }

  return getFluentWrapper(modelName, getResultType(modelName, actionName))
}

function getFluentWrapper(modelName: string, resultType: ts.TypeBuilder, nullType: ts.TypeBuilder = ts.neverType) {
  return ts
    .namedType(fluentWrapperName(modelName))
    .addGenericArgument(resultType)
    .addGenericArgument(nullType)
    .addGenericArgument(extArgsParam.toArgument())
    .addGenericArgument(ts.namedType('GlobalOmitOptions'))
}

function getResultType(modelName: string, actionName: DMMF.ModelAction) {
  return ts
    .namedType('$Result.GetResult')
    .addGenericArgument(ts.namedType(getPayloadName(modelName)).addGenericArgument(extArgsParam.toArgument()))
    .addGenericArgument(ts.namedType('T'))
    .addGenericArgument(ts.stringLiteral(actionName))
    .addGenericArgument(ts.namedType('GlobalOmitOptions'))
}

function buildFluentWrapperDefinition(modelName: string, outputType: DMMF.OutputType, context: GenerateContext) {
  const definition = ts.interfaceDeclaration(fluentWrapperName(modelName))
  definition
    .addGenericParameter(ts.genericParameter('T'))
    .addGenericParameter(ts.genericParameter('Null').default(ts.neverType))
    .addGenericParameter(extArgsParam)
    .addGenericParameter(ts.genericParameter('GlobalOmitOptions').default(ts.objectType()))
    .extends(tsx.prismaPromise(ts.namedType('T')))

  definition.add(ts.property(ts.toStringTag, ts.stringLiteral('PrismaPromise')).readonly())
  definition.addMultiple(
    outputType.fields
      .filter(
        (field) =>
          field.outputType.location === 'outputObjectTypes' &&
          !context.dmmf.isComposite(field.outputType.type) &&
          field.name !== '_count',
      )
      .map((field) => {
        const fieldArgType = ts
          .namedType(getFieldArgName(field, modelName))
          .addGenericArgument(extArgsParam.toArgument())

        const argsParam = ts.genericParameter('T').extends(fieldArgType).default(ts.objectType())
        return ts
          .method(field.name)
          .addGenericParameter(argsParam)
          .addParameter(ts.parameter('args', subset(argsParam.toArgument(), fieldArgType)).optional())
          .setReturnType(
            getReturnType({
              modelName: field.outputType.type,
              actionName: field.outputType.isList ? DMMF.ModelAction.findMany : DMMF.ModelAction.findUniqueOrThrow,
              isChaining: true,
              isNullable: field.isNullable,
            }),
          )
      }),
  )

  definition.add(
    ts
      .method('then')
      .setDocComment(
        ts.docComment`
          Attaches callbacks for the resolution and/or rejection of the Promise.
          @param onfulfilled The callback to execute when the Promise is resolved.
          @param onrejected The callback to execute when the Promise is rejected.
          @returns A Promise for the completion of which ever callback is executed.
        `,
      )
      .addGenericParameter(ts.genericParameter('TResult1').default(ts.namedType('T')))
      .addGenericParameter(ts.genericParameter('TResult2').default(ts.neverType))
      .addParameter(promiseCallback('onfulfilled', ts.parameter('value', ts.namedType('T')), ts.namedType('TResult1')))
      .addParameter(promiseCallback('onrejected', ts.parameter('reason', ts.anyType), ts.namedType('TResult2')))
      .setReturnType(tsx.promise(ts.unionType([ts.namedType('TResult1'), ts.namedType('TResult2')]))),
  )

  definition.add(
    ts
      .method('catch')
      .setDocComment(
        ts.docComment`
          Attaches a callback for only the rejection of the Promise.
          @param onrejected The callback to execute when the Promise is rejected.
          @returns A Promise for the completion of the callback.
        `,
      )
      .addGenericParameter(ts.genericParameter('TResult').default(ts.neverType))
      .addParameter(promiseCallback('onrejected', ts.parameter('reason', ts.anyType), ts.namedType('TResult')))
      .setReturnType(tsx.promise(ts.unionType([ts.namedType('T'), ts.namedType('TResult')]))),
  )

  definition.add(
    ts
      .method('finally')
      .setDocComment(
        ts.docComment`
          Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
          resolved value cannot be modified from the callback.
          @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
          @returns A Promise for the completion of the callback.
      `,
      )
      .addParameter(
        ts.parameter('onfinally', ts.unionType([ts.functionType(), ts.undefinedType, ts.nullType])).optional(),
      )
      .setReturnType(tsx.promise(ts.namedType('T'))),
  )

  return ts.moduleExport(definition).setDocComment(ts.docComment`
      The delegate class that acts as a "Promise-like" for ${modelName}.
      Why is this prefixed with \`Prisma__\`?
      Because we want to prevent naming conflicts as mentioned in
      https://github.com/prisma/prisma-client-js/issues/707
    `)
}

function promiseCallback(name: string, callbackParam: ts.Parameter, returnType: ts.TypeBuilder) {
  return ts
    .parameter(
      name,
      ts.unionType([
        ts.functionType().addParameter(callbackParam).setReturnType(typeOrPromiseLike(returnType)),
        ts.undefinedType,
        ts.nullType,
      ]),
    )
    .optional()
}

function typeOrPromiseLike(type: ts.TypeBuilder) {
  return ts.unionType([type, ts.namedType('PromiseLike').addGenericArgument(type)])
}

function subset(arg: ts.TypeBuilder, baseType: ts.TypeBuilder) {
  return ts.namedType('Subset').addGenericArgument(arg).addGenericArgument(baseType)
}

function fluentWrapperName(modelName: string) {
  return `Prisma__${modelName}Client`
}
