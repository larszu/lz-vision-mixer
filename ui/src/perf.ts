// Load and forecast wording: pure helpers (no DOM), unit-tested.
import { getLang, t } from './i18n'
import type { Forecast, Perf } from './types'

/** Machine share the engine counts as full (docs/api.md, forecast). */
export const CPU_BUDGET = 80

/** Fills {name} placeholders of a translated template. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`))
}

export function num(v: number, digits = 0): string {
  return new Intl.NumberFormat(getLang(), { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(v)
}

/** 50, 59.94, 49.7: as many decimals as the value needs, at most two. */
export const fps = (v: number) => num(v, 2)

export type LoadTone = 'ok' | 'warn' | 'error'

/**
 * Red when frames drop (engine says overloaded, or output clearly below
 * nominal); amber when output dips or the machine is past the budget.
 */
export function perfTone(p: Perf): LoadTone {
  const ratio = p.nominalFps > 0 ? p.outputFps / p.nominalFps : 1
  if (p.overloaded || ratio < 0.95) return 'error'
  if (ratio < 0.99 || p.systemCpu >= CPU_BUDGET) return 'warn'
  return 'ok'
}

/** Short note next to "Add input" / "Add mic"; null when there is nothing to say. */
export function roomShort(more: number | null): string | null {
  if (more == null) return null
  if (more === 0) return t('No room for more')
  return fill(t('Room for ~{n} more'), { n: more })
}

/** "About 5 more inputs and 40 more mics fit." */
export function forecastSentence(f: Forecast): string {
  if (f.moreInputs == null || f.moreMics == null) return t('No forecast yet.')
  if (f.moreInputs === 0 && f.moreMics === 0) return t('The machine is full: no more inputs or mics fit.')
  const inputs = fill(f.moreInputs === 1 ? t('{n} more input') : t('{n} more inputs'), { n: f.moreInputs })
  const mics = fill(f.moreMics === 1 ? t('{n} more mic') : t('{n} more mics'), { n: f.moreMics })
  return fill(t('About {inputs} and {mics} fit.'), { inputs, mics })
}

/** "One input costs about 38 % of one core, one mic about 1.5 %." */
export function costSentence(f: Forecast): string {
  return fill(t('One input costs about {input} % of one core, one mic about {mic} %.'), { input: num(f.perInput, 1), mic: num(f.perMic, 1) })
}

export function basisLabel(f: Forecast): string {
  return f.basis === 'measured' ? t('Measured on this machine') : t('Estimate')
}

export function basisSentence(f: Forecast): string {
  return f.basis === 'measured'
    ? t('The costs are learned from this machine while the engine runs, also from earlier runs, and get more exact as inputs come and go.')
    : t('Not measured yet: these are default costs. The engine learns the real ones on this machine once the number of running inputs changes, and refines them from then on.')
}

export const gb = (mb: number) => num(mb / 1024, 1)
