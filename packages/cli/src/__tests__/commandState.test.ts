import fs from 'fs'

import { CommandState, daysSinceFirstCommand, loadOrInitializeCommandState } from '../utils/commandState'

describe('command state', () => {
  let mockRead: jest.SpyInstance
  let mockWrite: jest.SpyInstance
  let mockMkdir: jest.SpyInstance
  let mockRename: jest.SpyInstance

  afterEach(() => {
    mockRead?.mockRestore()
    mockWrite?.mockRestore()
    mockMkdir?.mockRestore()
    mockRename?.mockRestore()
  })

  it("initialize with the date when the state file doesn't exist", async () => {
    mockRead = jest.spyOn(fs.promises, 'readFile').mockRejectedValue({ code: 'ENOENT' })
    mockWrite = jest.spyOn(fs.promises, 'writeFile').mockImplementation()
    mockMkdir = jest.spyOn(fs.promises, 'mkdir').mockImplementation()
    mockRename = jest.spyOn(fs.promises, 'rename').mockImplementation()

    const state = await loadOrInitializeCommandState()

    expect(state).toEqual({
      firstCommandTimestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/),
    })
    expect(mockRead).toHaveBeenCalledTimes(1)
    expect(mockMkdir).toHaveBeenCalledWith(expect.anything(), { recursive: true })
    expect(mockWrite).toHaveBeenCalledWith(expect.stringContaining('.tmp'), JSON.stringify(state))
    expect(mockRename).toHaveBeenCalledWith(expect.stringContaining('.tmp'), expect.not.stringContaining('.tmp'))
  })

  it('return the date when the state file does exist', async () => {
    const date = new Date('2023-01-01T00:00:00Z')

    mockRead = jest
      .spyOn(fs.promises, 'readFile')
      .mockResolvedValue(JSON.stringify({ firstCommandTimestamp: date.toISOString() }))
    mockWrite = jest.spyOn(fs.promises, 'writeFile').mockImplementation()
    mockRename = jest.spyOn(fs.promises, 'rename').mockImplementation()

    const state = await loadOrInitializeCommandState()

    expect(state).toEqual({ firstCommandTimestamp: date.toISOString() })
    expect(mockRead).toHaveBeenCalledTimes(1)
    expect(mockWrite).toHaveBeenCalledTimes(0)
    expect(mockRename).toHaveBeenCalledTimes(0)
  })

  it('gracefully re-initializes when the state file contains invalid JSON', async () => {
    mockRead = jest.spyOn(fs.promises, 'readFile').mockResolvedValue('invalid-json')
    mockWrite = jest.spyOn(fs.promises, 'writeFile').mockImplementation()
    mockMkdir = jest.spyOn(fs.promises, 'mkdir').mockImplementation()
    mockRename = jest.spyOn(fs.promises, 'rename').mockImplementation()

    const state = await loadOrInitializeCommandState()

    expect(state).toEqual({
      firstCommandTimestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/),
    })
    expect(mockRead).toHaveBeenCalledTimes(1)
    expect(mockMkdir).toHaveBeenCalledWith(expect.anything(), { recursive: true })
    expect(mockWrite).toHaveBeenCalledWith(expect.stringContaining('.tmp'), JSON.stringify(state))
    expect(mockRename).toHaveBeenCalledWith(expect.stringContaining('.tmp'), expect.not.stringContaining('.tmp'))
  })

  it('gracefully re-initializes when the state file has an invalid schema', async () => {
    mockRead = jest.spyOn(fs.promises, 'readFile').mockResolvedValue(JSON.stringify({ wrongField: 123 }))
    mockWrite = jest.spyOn(fs.promises, 'writeFile').mockImplementation()
    mockMkdir = jest.spyOn(fs.promises, 'mkdir').mockImplementation()
    mockRename = jest.spyOn(fs.promises, 'rename').mockImplementation()

    const state = await loadOrInitializeCommandState()

    expect(state).toEqual({
      firstCommandTimestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/),
    })
    expect(mockRead).toHaveBeenCalledTimes(1)
    expect(mockMkdir).toHaveBeenCalledWith(expect.anything(), { recursive: true })
    expect(mockWrite).toHaveBeenCalledWith(expect.stringContaining('.tmp'), JSON.stringify(state))
    expect(mockRename).toHaveBeenCalledWith(expect.stringContaining('.tmp'), expect.not.stringContaining('.tmp'))
  })

  it('gracefully re-initializes when the state file cannot be read', async () => {
    mockRead = jest.spyOn(fs.promises, 'readFile').mockRejectedValue({ code: 'EACCES' })
    mockWrite = jest.spyOn(fs.promises, 'writeFile').mockImplementation()
    mockMkdir = jest.spyOn(fs.promises, 'mkdir').mockImplementation()
    mockRename = jest.spyOn(fs.promises, 'rename').mockImplementation()

    const state = await loadOrInitializeCommandState()

    expect(state).toEqual({
      firstCommandTimestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/),
    })
    expect(mockRead).toHaveBeenCalledTimes(1)
    expect(mockWrite).toHaveBeenCalledWith(expect.stringContaining('.tmp'), JSON.stringify(state))
  })

  it('returns the in-memory state when persisting it fails', async () => {
    mockRead = jest.spyOn(fs.promises, 'readFile').mockRejectedValue({ code: 'ENOENT' })
    mockWrite = jest.spyOn(fs.promises, 'writeFile').mockRejectedValue({ code: 'ENOSPC' })
    mockMkdir = jest.spyOn(fs.promises, 'mkdir').mockImplementation()
    mockRename = jest.spyOn(fs.promises, 'rename').mockImplementation()

    const state = await loadOrInitializeCommandState()

    expect(state).toEqual({
      firstCommandTimestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/),
    })
    expect(mockWrite).toHaveBeenCalledWith(expect.stringContaining('.tmp'), JSON.stringify(state))
    expect(mockRename).toHaveBeenCalledTimes(0)
  })

  it('calculate the days since last command', () => {
    const start = new Date('2023-01-01T00:00:00Z')
    const end = new Date('2025-05-14T12:00:00Z')

    const state: CommandState = {
      firstCommandTimestamp: start.toISOString(),
    }

    expect(daysSinceFirstCommand(state, end)).toEqual(864)
  })
})
