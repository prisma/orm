import type { CommandCompletion } from '@prisma/internals'

export const mcpCompletion: CommandCompletion = {
  name: 'mcp',
  description: 'Starts an MCP server to use with AI development tools',
  options: [{ name: 'early-access', description: 'Enable early access features' }],
}
