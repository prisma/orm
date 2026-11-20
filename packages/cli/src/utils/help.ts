import { format, HelpError } from '@prisma/internals'
import { bold, dim, red } from 'kleur/colors'

export interface HelpContent {
  usageLine: string
  subcommands?: string[][]
  options?: string[][]
  examples?: string[]
  additionalContent?: string[]
}

export function createHelp(content: HelpContent) {
  const { usageLine, subcommands, options, examples, additionalContent } = content

  const usage = format(`
${bold('Usage')}

  ${dim('$')} ${usageLine}
`)

  const commands =
    subcommands &&
    format(`
${bold('Commands')}

${subcommands.map(([option, description]) => `${option.padStart(15)}   ${description}`).join('\n')}
  `)

  const options_ =
    options &&
    format(`
${bold('Options')}

${options.map(([option, alias, description]) => `  ${option.padStart(15)} ${alias ? alias + ',' : ''}   ${description}`).join('\n')}
  `)

  const examples_ =
    examples &&
    format(`
${bold('Examples')}

${examples.map((example) => `  ${dim('$')} ${example}`).join('\n')}
  `)

  const additionalContent_ =
    additionalContent &&
    format(`
${additionalContent.map((entry) => `${entry}`).join('\n')}
  `)

  const help = [usage, commands, options_, examples_, additionalContent_].filter(Boolean).join('')
  return (error?: string) => (error ? new HelpError(`\n${bold(red(`!`))} ${error}\n${help}`) : help)
}
