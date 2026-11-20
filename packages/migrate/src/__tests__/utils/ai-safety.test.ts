import { agentMatchers, aiAgentConfirmationCheckpoint } from '../../utils/ai-safety'

const agentEnvVars = [
  ...new Set(agentMatchers.flatMap((matcher) => matcher.envVars)),
  'PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION',
]

// File-based markers read as absent by default so the suite is stable even
// when it runs inside an agent VM that has them (e.g. Devin).
const checkpoint = (fileExists: (path: string) => boolean = () => false) =>
  aiAgentConfirmationCheckpoint({ env: process.env, fileExists })

beforeEach(() => {
  // The tests themselves may be running under an AI agent, so the inherited
  // markers must be cleared before each test.
  for (const name of agentEnvVars) {
    delete process.env[name]
  }
})

test('passes when no AI agent is detected', () => {
  expect(() => checkpoint()).not.toThrow()
})

test.each([
  ['CLAUDECODE', '1', 'Claude Code'],
  ['CODEX_THREAD_ID', '018f8c4e-0000-7000-8000-000000000000', 'Codex CLI'],
  ['CODEX_CI', '1', 'Codex CLI'],
  ['CODEX_SANDBOX', 'seatbelt', 'Codex CLI'],
  ['CODEX_SANDBOX_NETWORK_DISABLED', '1', 'Codex CLI'],
  ['GEMINI_CLI', '1', 'Gemini CLI'],
  ['QWEN_CODE', '1', 'Qwen Code'],
  ['CURSOR_AGENT', '1', 'Cursor'],
  ['COPILOT_CLI', '1', 'GitHub Copilot CLI'],
  ['OPENCODE', '1', 'OpenCode'],
  ['OPENCODE_CLIENT', '1', 'OpenCode'],
  ['CLINE_ACTIVE', 'true', 'Cline'],
  ['CRUSH', '1', 'Crush'],
  ['AGENT', 'goose', 'Goose'],
  ['AGENT', 'amp', 'Amp'],
  ['OR_APP_NAME', 'Aider', 'Aider'],
  ['AUGMENT_AGENT', '1', 'Augment Code'],
  ['ANTIGRAVITY_AGENT', '1', 'Antigravity'],
  ['REPLIT_SESSION', 'agent-12345678-aBcDeFgHiJkLmNoPq-X01', 'Replit Agent'],
])('detects %s=%s as %s', (envVar, value, agentName) => {
  process.env[envVar] = value
  expect(() => checkpoint()).toThrow(`invoked by ${agentName}`)
})

test('reports the agent name from the generic AI_AGENT convention', () => {
  process.env.AI_AGENT = 'v0'
  expect(() => checkpoint()).toThrow('invoked by an AI agent identifying itself as "v0"')
})

test('reports the agent name from the generic AGENT convention', () => {
  process.env.AGENT = 'some-new-agent'
  expect(() => checkpoint()).toThrow('invoked by an AI agent identifying itself as "some-new-agent"')
})

test('detects Devin via its marker file', () => {
  expect(() => checkpoint((path) => path === '/opt/.devin')).toThrow('invoked by Devin')
})

test('sanitizes non-printable characters in generic agent names', () => {
  process.env.AI_AGENT = 'some\nagent\u0000name'
  expect(() => checkpoint()).toThrow('invoked by an AI agent identifying itself as "some agent name"')
})

test('caps the length of generic agent names', () => {
  process.env.AI_AGENT = 'a'.repeat(200)
  expect(() => checkpoint()).toThrow(`identifying itself as "${'a'.repeat(64)}"`)
})

test('reports an unidentified agent for a generic marker with no printable characters', () => {
  process.env.AI_AGENT = '\u0001\u0002'
  expect(() => checkpoint()).toThrow('invoked by an unidentified AI agent')
})

test('reports an unidentified agent for AGENT=1', () => {
  process.env.AGENT = '1'
  expect(() => checkpoint()).toThrow('invoked by an unidentified AI agent')
})

test('does not treat a human-controlled Replit shell as an agent', () => {
  process.env.REPLIT_SESSION = 'prisma-Abcd'
  expect(() => checkpoint()).not.toThrow()
})

test('does not treat other OR_APP_NAME values as Aider', () => {
  process.env.OR_APP_NAME = 'SomeOtherApp'
  expect(() => checkpoint()).not.toThrow()
})

test('passes when the user consent environment variable is set', () => {
  process.env.CLAUDECODE = '1'
  process.env.PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION = 'yes, reset my dev database'
  expect(() => checkpoint()).not.toThrow()
})
