import { describe, expect, it } from 'vitest'
import { DEFAULT_ENGINE, parseArgs } from '../src/main/cli'

describe('parseArgs', () => {
  it('has defaults', () => {
    expect(parseArgs(['.'])).toEqual({ engine: DEFAULT_ENGINE, graphics: [], hidden: false })
  })
  it('reads --engine, repeated --graphics and --hidden, in both spellings', () => {
    expect(parseArgs(['.', '--engine', 'ws://10.0.0.2:4195/renderer', '--graphics', '/a', '--graphics=/b c', '--hidden', '--disable-gpu'])).toEqual({
      engine: 'ws://10.0.0.2:4195/renderer',
      graphics: ['/a', '/b c'],
      hidden: true,
    })
  })
  it('ignores a flag without value', () => {
    expect(parseArgs(['--graphics', '--hidden'])).toEqual({ engine: DEFAULT_ENGINE, graphics: [], hidden: true })
  })
})
