// LZ Bug – EBU OGraf v1 graphic, Lars Zumpe Medienproduktion design (Brand Guide 2.0).
// Static corner label like the brand's LIVE overlay: navy plate, Public Sans ExtraBold in capitals.
// Fades in and out in 300 ms; nothing blinks. Layout at 1920 × 1080, scaled.

const FONT = 'LZM Public Sans'
const FONT_ID = 'lzm-font-lz-bug'
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
  await document.fonts.load(`800 20px '${FONT}'`, text || 'A').catch(() => {})
}

// "lz" monogram from the brand kit's signet, without the tally dot (allowed at small sizes).
const MONOGRAM = `<svg class="mono" viewBox="478 455 180 141" aria-hidden="true"><path fill="currentColor" d="M478.129 595.445 505.285 455.570H540.207L513.047 595.445Z M638.277 595.445 L555.828 595.445 L561.062 568.285 L610.922 521.727 L570.183 521.727 L575.422 494.566 L657.871 494.566 L652.633 521.727 L602.773 568.285 L643.515 568.285 Z"/></svg>`

const DEFAULTS = { text: 'Live', corner: 'top-right', tally: false, monogram: false, plate: true }
const FADE_MS = 300

const CSS = `
:host { position: absolute; inset: 0; display: block; overflow: hidden; pointer-events: none; --u: 1px; --ease: cubic-bezier(.2,.8,.2,1);
  font-family: '${FONT}', 'Public Sans', system-ui, 'Segoe UI', Roboto, Arial, sans-serif; }
.bug { position: absolute; top: calc(60 * var(--u)); right: calc(120 * var(--u)); display: flex; align-items: center; gap: calc(12 * var(--u));
  height: calc(44 * var(--u)); padding: 0 calc(20 * var(--u)) 0 calc(18 * var(--u)); box-sizing: border-box; background: rgba(29, 50, 79, .92);
  color: #fff; opacity: 0; transition: opacity ${FADE_MS}ms var(--ease); }
.bug.in { opacity: 1; }
.bug.tl { left: calc(120 * var(--u)); right: auto; }
.bug.bl { left: calc(120 * var(--u)); right: auto; top: auto; bottom: calc(60 * var(--u)); }
.bug.br { top: auto; bottom: calc(60 * var(--u)); }
.bug.bare { background: transparent; padding: 0; }
.tally { width: calc(14 * var(--u)); height: calc(14 * var(--u)); background: #D6402E; transform: skewX(-8.7deg); flex: none; }
.mono { height: calc(22 * var(--u)); width: auto; flex: none; display: block; }
.text { font-weight: 800; font-size: calc(20 * var(--u)); line-height: 1; letter-spacing: calc(3 * var(--u)); text-transform: uppercase; white-space: nowrap;
  transition: opacity 150ms linear; }
.instant, .instant * { transition: none !important; }
[hidden] { display: none !important; }
`

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const CORNER_CLASS = { 'top-left': 'tl', 'top-right': 'tr', 'bottom-left': 'bl', 'bottom-right': 'br' }

class Bug extends HTMLElement {
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
    ensureFontFace()
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' })
    root.innerHTML = `<style>${CSS}</style><div class="bug"><div class="tally"></div>${MONOGRAM}<div class="text"></div></div>`
    this.bug = root.querySelector('.bug')
    this.textEl = root.querySelector('.text')
    this.currentStep = undefined
    this.visible = false
    this.style.setProperty('--u', `${Math.min(this.size.width / 1920, this.size.height / 1080)}px`)
    await fontsReady(this.data.text)
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
    await fontsReady(this.data.text)
    if (!this.visible || skipAnimation) {
      this.instant(() => this.apply())
      return { statusCode: 200 }
    }
    if (prev.corner !== this.data.corner) {
      await this.setVisible(false, false)
      this.instant(() => this.apply())
      await this.setVisible(true, false)
    } else {
      this.textEl.style.opacity = '0'
      await wait(150)
      this.apply()
      this.textEl.style.opacity = '1'
      await wait(150)
    }
    return { statusCode: 200 }
  }

  async customAction({ id } = {}) {
    return { statusCode: 404, statusMessage: `Unknown custom action "${id}"` }
  }

  apply() {
    const d = this.data
    const text = String(d.text ?? '')
    this.textEl.textContent = text
    this.textEl.hidden = !text
    const corner = CORNER_CLASS[d.corner] ?? 'tr'
    for (const c of Object.values(CORNER_CLASS)) this.bug.classList.toggle(c, c === corner)
    this.bug.classList.toggle('bare', d.plate === false)
    this.bug.querySelector('.tally').hidden = !d.tally
    this.bug.querySelector('.mono').style.display = d.monogram ? '' : 'none'
  }

  instant(fn) {
    this.bug.classList.add('instant')
    fn()
    void this.bug.offsetWidth
    this.bug.classList.remove('instant')
  }

  async setVisible(on, skipAnimation) {
    if (!this.bug) return
    const changed = this.visible !== on
    this.visible = on
    if (skipAnimation) {
      this.instant(() => this.bug.classList.toggle('in', on))
      return
    }
    this.bug.classList.toggle('in', on)
    if (changed) await wait(FADE_MS)
  }
}

export default Bug
