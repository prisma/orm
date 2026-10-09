import type { PromptSurface } from '@prisma/cli-engine';
import type { AnswerPlanQuestions, PlanAnswer } from '../control-api/statements/plan-questions';

/**
 * Asks a plan's questions through the engine's statement prompt, all in one batch that refuses a
 * statement nothing consumed before the command acts. Flags answer first; where nobody can answer,
 * the engine refuses and lists every question.
 */
export function promptPlanQuestions(prompt: PromptSurface): AnswerPlanQuestions {
  return async (questions): Promise<readonly PlanAnswer[]> => {
    const answers = await prompt.statements(
      questions.map((question) => ({
        question: question.question,
        subject: question.subject,
        verbs: question.verbs,
        forms: question.forms,
        validate: question.validate,
      })),
      { last: true },
    );
    return answers.map(({ verb, text }) => ({ verb, text }));
  };
}
