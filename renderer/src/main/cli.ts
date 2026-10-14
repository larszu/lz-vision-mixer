// Command line of the renderer. Pure.

export interface CliOptions {
  engine: string
  graphics: string[]
  hidden: boolean
}

export const DEFAULT_ENGINE = 'ws://127.0.0.1:4195/renderer'

/**
 * Reads `--engine <url>`, `--graphics <dir>` (repeatable) and `--hidden` from argv.
 * Also accepts `--engine=<url>` / `--graphics=<dir>`. Unknown arguments (Chromium switches,
 * the app path) are ignored.
 */
export function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { engine: DEFAULT_ENGINE, graphics: [], hidden: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined]
    const value = (): string | undefined => {
      if (inline !== undefined) return inline
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) return undefined
      i++
      return next
    }
    if (flag === '--engine') {
      const v = value()
      if (v) opts.engine = v
    } else if (flag === '--graphics') {
      const v = value()
      if (v) opts.graphics.push(v)
    } else if (flag === '--hidden') {
      opts.hidden = true
    }
  }
  return opts
}
