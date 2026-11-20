import {
  type PlanQuestion,
  planQuestion,
} from '../../../src/control-api/statements/plan-questions';

/** A question about a model that only a delete answers, of a removed namespace when one is given. */
export function question(subject: string, namespace?: string): PlanQuestion {
  return planQuestion({
    headline: `Removing model "${subject}" would delete its data.`,
    named: `model "${subject}"`,
    operations: [`Drop ${subject}`],
    notes: [],
    keepDataWays: [],
    answers: [
      {
        flag: { verb: 'delete', text: subject },
        meaning: 'If its data can go',
        meaningNamingSubject: `If the data of model "${subject}" can go`,
        promptMeaning: 'delete lets its data go',
      },
    ],
    whenDeleted: [],
    effect: 'deletes data',
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
    validate: () => undefined,
  });
}
