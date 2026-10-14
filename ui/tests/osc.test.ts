import { describe, expect, it } from 'vitest'
import { OSC_FEEDBACK, OSC_RECEIVE, oscTargetProblem } from '../src/osc'

describe('OSC feedback targets', () => {
  it('accepts host:port', () => {
    for (const ok of ['127.0.0.1:9000', 'companion.local:12321', ' 192.168.1.20:8000 ', 'localhost:1', '[::1]:9000', 'my-box:65535'])
      expect(oscTargetProblem(ok), ok).toBeNull()
  })
  it('names what is wrong', () => {
    expect(oscTargetProblem('')).toBe('empty')
    expect(oscTargetProblem('   ')).toBe('empty')
    expect(oscTargetProblem('192.168.1.20')).toBe('format')
    expect(oscTargetProblem('host:')).toBe('format')
    expect(oscTargetProblem('a b:9000')).toBe('format')
    expect(oscTargetProblem('udp://host:9000')).toBe('format')
    expect(oscTargetProblem('300.1.1.1:9000')).toBe('host')
    expect(oscTargetProblem('1.2.3:9000')).toBe('host')
    expect(oscTargetProblem('-bad-:9000')).toBe('host')
    expect(oscTargetProblem('host:0')).toBe('port')
    expect(oscTargetProblem('host:70000')).toBe('port')
  })
  it('rejects duplicates', () => {
    expect(oscTargetProblem('Host:9000', ['host:9000'])).toBe('duplicate')
    expect(oscTargetProblem('host:9001', ['host:9000'])).toBeNull()
  })
})

describe('OSC cheat sheet', () => {
  it('lists the addresses from the API', () => {
    const all = [...OSC_RECEIVE, ...OSC_FEEDBACK].map((e) => e.address).join(' ')
    for (const a of ['/lzvm/cut', '/lzvm/tbar', '/lzvm/caption', '/lzvm/cmd', '/lzvm/tally/<n>', '/lzvm/vfa/speaking']) expect(all).toContain(a)
  })
})
