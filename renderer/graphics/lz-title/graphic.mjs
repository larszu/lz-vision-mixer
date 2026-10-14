// LZ Title – EBU OGraf v1 graphic, Lars Zumpe Medienproduktion design (Brand Guide 2.0).
// Title-safe card (10 % margins): optional kicker in capitals with the steel-blue head line,
// headline Public Sans Black in capitals (tracking −15), subline Medium.
// In: plate wipes from the left (450 ms), line and text follow; out in reverse. Ease-out
// cubic-bezier(.2,.8,.2,1), no movement longer than 450 ms. Layout at 1920 × 1080, scaled.

const FONT = 'LZM Public Sans'
const FONT_ID = 'lzm-font-lz-title'
const LATIN = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'
const LATIN_EXT = 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF'

function ensureFontFace() {
  if (document.getElementById(FONT_ID)) return
  const url = (f) => new URL(`./fonts/${f}`, import.meta.url).href
  const style = document.createElement('style')
  style.id = FONT_ID
  style.textContent = `
@font-face { font-family: '${FONT}'; font-weight: 100 900; font-display: block; src: url(${url('public-sans-latin-ext-wght-normal.woff2')}) format('woff2'); unicode-range: ${LATIN_EXT}; }
@font-face { font-family: '${FONT}'; font-weight: 100 900; font-display: block; src: url(${url('public-sans-latin-wght-normal.woff2')}) format('woff2'); unicode-range: ${LATIN}; }`
  document.head.append(style)
}
async function fontsReady(text) {
  const sample = text || 'Aa'
  await Promise.all(['500', '700', '900'].map((w) => document.fonts.load(`${w} 24px '${FONT}'`, sample))).catch(() => {})
}

const DEFAULTS = { kicker: '', headline: 'Titel der Sendung', subline: 'Untertitel · Ort · Datum', backdrop: 'plate' }
const IN_MS = 650
const OUT_MS = 450
const HEADLINE = 96 // px at 1080
const HEADLINE_MIN = 48
const HEADLINE_LINES = 2

const CSS = `
:host { position: absolute; inset: 0; display: block; overflow: hidden; pointer-events: none; --u: 1px; --ease: cubic-bezier(.2,.8,.2,1);
  font-family: '${FONT}', 'Public Sans', system-ui, 'Segoe UI', Roboto, Arial, sans-serif; }
.full { position: absolute; inset: 0; background: #132040; opacity: 0; transition: opacity 300ms var(--ease) 150ms; }
.root.in .full { opacity: 1; transition-delay: 0ms; }
.root:not(.bg-full) .full { display: none; }
.card { position: absolute; left: calc(192 * var(--u)); top: 50%; translate: 0 -50%; box-sizing: border-box; width: max-content;
  max-width: calc(1536 * var(--u)); padding: calc(56 * var(--u)) calc(64 * var(--u)); background: rgba(29, 50, 79, .92);
  clip-path: inset(0 100% 0 0); transition: clip-path 450ms var(--ease) 0ms; }
.root.in .card { clip-path: inset(0 0 0 0); }
.root:not(.bg-plate) .card { background: transparent; padding: 0; }
.text { transition: opacity 150ms linear; }
.kicker { font-weight: 700; font-size: calc(18 * var(--u)); line-height: 1.2; letter-spacing: .18em; text-transform: uppercase; color: #8C9CB3; }
.rule { height: calc(2 * var(--u)); background: #8C9CB3; margin: calc(14 * var(--u)) 0 calc(32 * var(--u)); transform: scaleX(0); transform-origin: left;
  transition: transform 300ms var(--ease) 0ms; }
.root.in .rule { transform: scaleX(1); transition-delay: 150ms; }
.headline { font-weight: 900; line-height: 1.02; letter-spacing: -.015em; text-transform: uppercase; color: #fff; overflow-wrap: break-word;
  max-width: calc(1408 * var(--u)); opacity: 0; translate: 0 calc(24 * var(--u)); transition: opacity 300ms var(--ease) 0ms, translate 450ms var(--ease) 0ms; }
.subline { font-weight: 500; font-size: calc(34 * var(--u)); line-height: 1.3; color: #E1ECEF; margin-top: calc(20 * var(--u)); max-width: calc(1408 * var(--u));
  opacity: 0; translate: 0 calc(16 * var(--u)); transition: opacity 300ms var(--ease) 0ms, translate 450ms var(--ease) 0ms; }
.root.in .headline { opacity: 1; translate: 0 0; transition-delay: 100ms; }
.root.in .subline { opacity: 1; translate: 0 0; transition-delay: 200ms; }
.instant, .instant * { transition: none !important; }
[hidden] { display: none !important; }
`

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

class Title extends HTMLElement {
  constructor() {
    super()
    this.data = { ...DEFAULTS }
    this.currentStep = undefined
    this.visible = false
    this.size = { width: 1920, height: 1080 }
  }

  async load({ data, renderType, renderCharacteristics } = {}) {
    if (renderType && renderType !== 'realtime') return { statusCode: 400, statusMessage: 'Only real-time rendering is supported' }
    this.data = { ...DEFAULTS, ...(data ?? {}) }
    const res = renderCharacteristics?.resolution
    if (res?.width && res?.height) this.size = { width: res.width, height: res.height }
    this.unit = Math.min(this.size.width / 1920, this.size.height / 1080)
    this.style.setProperty('--u', `${this.unit}px`)
    ensureFontFace()
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' })
    root.innerHTML = `<style>${CSS}</style><div class="root"><div class="full"></div>
      <div class="card"><div class="text"><div class="kicker"></div><div class="rule"></div><div class="headline"></div><div class="subline"></div></div></div></div>`
    this.root = root.querySelector('.root')
    this.textEl = root.querySelector('.text')
    this.el = Object.fromEntries(['kicker', 'rule', 'headline', 'subline'].map((k) => [k, root.querySelector(`.${k}`)]))
    this.currentStep = undefined
    this.visible = false
    await fontsReady(this.allText())
    this.apply()
    return { statusCode: 200 }
  }

  async dispose() {
    if (this.shadowRoot) this.shadowRoot.innerHTML = ''
    this.currentStep = undefined
    this.visible = false
    return { statusCode: 200 }
  }

  async playAction({ goto, delta, skipAnimation } = {}) {
    let target = Number.isInteger(goto) && goto >= 0 ? goto : (this.currentStep ?? -1) + (Number.isInteger(delta) ? delta : 1)
    if (target >= 1) {
      await this.setVisible(false, skipAnimation)
      this.currentStep = undefined
      return { statusCode: 200, currentStep: undefined }
    }
    if (target < 0) target = 0
    this.currentStep = target
    await this.setVisible(true, skipAnimation)
    return { statusCode: 200, currentStep: this.currentStep }
  }

  async stopAction({ skipAnimation } = {}) {
    await this.setVisible(false, skipAnimation)
    this.currentStep = undefined
    return { statusCode: 200 }
  }

  async updateAction({ data, skipAnimation } = {}) {
    const prev = this.data
    this.data = { ...this.data, ...(data ?? {}) }
    await fontsReady(this.allText())
    if (!this.visible || skipAnimation) {
      this.instant(() => this.apply())
      return { statusCode: 200 }
    }
    if (prev.backdrop !== this.data.backdrop) {
      await this.setVisible(false, false)
      this.instant(() => this.apply())
      await this.setVisible(true, false)
      return { statusCode: 200 }
    }
    this.textEl.style.opacity = '0'
    await wait(150)
    this.apply()
    this.textEl.style.opacity = '1'
    await wait(300)
    return { statusCode: 200 }
  }

  async customAction({ id } = {}) {
    return { statusCode: 404, statusMessage: `Unknown custom action "${id}"` }
  }

  allText() {
    return `${this.data.kicker}${this.data.headline}${this.data.subline}`
  }

  apply() {
    const d = this.data
    for (const key of ['kicker', 'headline', 'subline']) {
      const value = String(d[key] ?? '')
      this.el[key].textContent = value
      this.el[key].hidden = !value
    }
    this.el.rule.hidden = !d.kicker
    const bg = ['plate', 'full', 'none'].includes(d.backdrop) ? d.backdrop : 'plate'
    this.root.classList.remove('bg-plate', 'bg-full', 'bg-none')
    this.root.classList.add(`bg-${bg}`)
    this.fitHeadline()
  }

  /** Largest size up to 96 px (at 1080) that keeps the headline within two lines. */
  fitHeadline() {
    const h = this.el.headline
    let size = HEADLINE
    const set = () => (h.style.fontSize = `${size * this.unit}px`)
    set()
    const fits = () => h.scrollHeight <= size * this.unit * 1.02 * HEADLINE_LINES + 1 && h.scrollWidth <= h.clientWidth + 1
    while (size > HEADLINE_MIN && !fits()) {
      size = Math.max(HEADLINE_MIN, Math.floor(size * 0.94))
      set()
    }
  }

  instant(fn) {
    this.root.classList.add('instant')
    fn()
    void this.root.offsetWidth
    this.root.classList.remove('instant')
  }

  async setVisible(on, skipAnimation) {
    if (!this.root) return
    const changed = this.visible !== on
    this.visible = on
    if (skipAnimation) {
      this.instant(() => this.root.classList.toggle('in', on))
      return
    }
    this.root.classList.toggle('in', on)
    if (changed) await wait(on ? IN_MS : OUT_MS)
  }
}

export default Title
