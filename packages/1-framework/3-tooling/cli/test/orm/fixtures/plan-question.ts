import {
  type PlanQuestion,
  planQuestion,
} from '../../../src/control-api/statements/plan-questions';

/** A question about a model that only a delete answers, of a removed namespace when one is given. */
export function question(subject: string, namespace?: string): PlanQuestion {
  return planQuestion({
    headline: `Removing model "${subject}" would delete its data.`,
    operations: [`Drop ${subject}`],
    notes: [],
    answers: [
      {
        flag: { verb: 'delete', text: subject },
        ifOnly: 'If its data can go',
        ifNamed: `If the data of model "${subject}" can go`,
        typed: 'delete lets its data go',
      },
    ],
    yesWould: 'delete data',
    subject,
    ...(namespace === undefined
      ? {}
      : {
          removedNamespace: namespace,
          namespaceAnswer: (verb: string, text: string) =>
            verb === 'delete' && text === namespace
              ? ('delete' as const)
              : verb === 'rename' && text.startsWith(`${namespace}:`)
                ? ('rename' as const)
                : undefined,
        }),
    verbs: ['delete'],
    forms: {},
    validate: () => undefined,
  });
}
