import { bold } from 'kleur/colors'

import { highlightDatamodel } from '../highlight/highlight'
import { link } from './link'

export const missingDatasource = `\nYou don't have any ${bold('datasource')} defined in your ${bold('schema.prisma')}.
You can define a datasource like this:

${bold(
  highlightDatamodel(`datasource db {
  provider = "postgresql"
}`),
)}

More information in our documentation:
${link('https://pris.ly/d/prisma-schema')}
`
