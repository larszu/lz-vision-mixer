// OGraf host page: runs inside one offscreen layer window. The main process drives it through
// window.__ografHost.run(command) (webContents.executeJavaScript) and gets each OGraf result back.
//
// Follows EBU OGraf v1, "Requirements for a Renderer": load() is called and awaited before any
// action; dispose() is called and awaited when the graphic is removed. Commands run one after the
// other, so a step change is only reported once the graphic has resolved the action.

interface OGrafGraphic extends HTMLElement {
  load(params: { data: unknown; renderType: 'realtime'; renderCharacteristics: RenderCharacteristics }): Promise<unknown>
  dispose(params: Record<string, never>): Promise<unknown>
  playAction(params: { delta?: number; goto?: number; skipAnimation?: boolean }): Promise<unknown>
  stopAction(params: { skipAnimation?: boolean }): Promise<unknown>
  updateAction(params: { data: unknown; skipAnimation?: boolean }): Promise<unknown>
  customAction(params: { id: string; payload: unknown; skipAnimation?: boolean }): Promise<unknown>
}

interface RenderCharacteristics {
  resolution: { width: number; height: number }
  frameRate: number
  accessToPublicInternet?: boolean
}

type Command =
  | { op: 'load'; moduleUrl: string; tag: string; data: unknown; renderCharacteristics: RenderCharacteristics }
  | { op: 'play'; params: { delta?: number; goto?: number; skipAnimation?: boolean } }
  | { op: 'stop'; params: { skipAnimation?: boolean } }
  | { op: 'update'; data: unknown; skipAnimation?: boolean }
  | { op: 'custom'; id: string; payload: unknown; skipAnimation?: boolean }
  | { op: 'clear' }

/** Normalised OGraf ReturnPayload. `hasStep` tells whether the graphic reported a step. */
interface Result {
  statusCode: number
  statusMessage?: string
  hasStep: boolean
  currentStep?: number
}

const stage = document.getElementById('stage') as HTMLDivElement
let graphic: OGrafGraphic | null = null

function normalise(ret: unknown, stepExpected: boolean): Result {
  // A Promise that resolves to undefined counts as { statusCode: 200 } (OGraf v1).
  if (ret === undefined || ret === null || typeof ret !== 'object') return { statusCode: 200, hasStep: false }
  const r = ret as Record<string, unknown>
  const statusCode = typeof r.statusCode === 'number' ? r.statusCode : 200
  const out: Result = { statusCode, hasStep: false }
  if (typeof r.statusMessage === 'string') out.statusMessage = r.statusMessage
  if ('currentStep' in r || stepExpected) {
    out.hasStep = 'currentStep' in r
    if (typeof r.currentStep === 'number') out.currentStep = r.currentStep
  }
  return out
}

function failure(e: unknown): Result {
  const message = e instanceof Error ? e.message : String(e)
  return { statusCode: 500, statusMessage: message, hasStep: false }
}

async function dispose(): Promise<void> {
  const g = graphic
  graphic = null
  if (!g) return
  try {
    await g.dispose({})
  } catch (e) {
    console.error('[ograf] dispose failed', e)
  } finally {
    g.remove()
    stage.replaceChildren()
  }
}

async function load(cmd: Extract<Command, { op: 'load' }>): Promise<Result> {
  await dispose()
  let ctor = customElements.get(cmd.tag)
  if (!ctor) {
    const mod = (await import(cmd.moduleUrl)) as { default?: unknown }
    if (typeof mod.default !== 'function') {
      const named = Object.keys(mod)
      throw new Error(
        named.length
          ? `The graphic must export its class as the default export (found: ${named.join(', ')})`
          : 'The graphic module has no default export',
      )
    }
    customElements.define(cmd.tag, mod.default as CustomElementConstructor)
    ctor = customElements.get(cmd.tag)
  }
  const el = document.createElement(cmd.tag) as OGrafGraphic
  for (const m of ['load', 'dispose', 'playAction', 'stopAction', 'updateAction', 'customAction'] as const) {
    if (typeof el[m] !== 'function') throw new Error(`The graphic does not implement ${m}()`)
  }
  stage.appendChild(el)
  graphic = el
  try {
    const r = normalise(await el.load({ data: cmd.data, renderType: 'realtime', renderCharacteristics: cmd.renderCharacteristics }), false)
    if (r.statusCode >= 400) await dispose()
    return r
  } catch (e) {
    await dispose()
    throw e
  }
}

function needGraphic(): OGrafGraphic {
  if (!graphic) throw Object.assign(new Error('No graphic loaded'), { statusCode: 409 })
  return graphic
}

async function exec(cmd: Command): Promise<Result> {
  switch (cmd.op) {
    case 'load':
      return load(cmd)
    case 'clear':
      await dispose()
      return { statusCode: 200, hasStep: false }
    case 'play':
      return normalise(await needGraphic().playAction(cmd.params), true)
    case 'stop':
      return normalise(await needGraphic().stopAction(cmd.params), false)
    case 'update': {
      const p: { data: unknown; skipAnimation?: boolean } = { data: cmd.data }
      if (cmd.skipAnimation !== undefined) p.skipAnimation = cmd.skipAnimation
      return normalise(await needGraphic().updateAction(p), false)
    }
    case 'custom': {
      const p: { id: string; payload: unknown; skipAnimation?: boolean } = { id: cmd.id, payload: cmd.payload }
      if (cmd.skipAnimation !== undefined) p.skipAnimation = cmd.skipAnimation
      return normalise(await needGraphic().customAction(p), false)
    }
  }
}

let queue: Promise<unknown> = Promise.resolve()

// A graphic whose Promise never settles must not block the layer for good.
const TIMEOUT_MS = { load: 30000, other: 15000 }
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const t = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`${what} did not resolve within ${ms / 1000} s`), { statusCode: 504 })), ms)
  })
  return Promise.race([p, t]).finally(() => clearTimeout(timer))
}

async function run(cmd: Command): Promise<Result> {
  const job = queue.then(async () => {
    try {
      return await withTimeout(exec(cmd), cmd.op === 'load' ? TIMEOUT_MS.load : TIMEOUT_MS.other, cmd.op)
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode
      return code ? { statusCode: code, statusMessage: (e as Error).message, hasStep: false } : failure(e)
    }
  })
  queue = job.catch(() => undefined)
  return job
}

;(window as unknown as { __ografHost: unknown }).__ografHost = { run, ready: true }
