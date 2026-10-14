// LZ Lower third – EBU OGraf v1 graphic, Lars Zumpe Medienproduktion design (Brand Guide 2.0).
// Plate: navy 92 %, 6 px tally edge grows from the bottom (300 ms), plate slides in (450 ms),
// out in reverse. Open: steel-blue line, tally dot, name 44 / function 26.
// Ease-out cubic-bezier(.2,.8,.2,1), no movement longer than 450 ms. Layout at 1920 × 1080, scaled.

const FONT = 'LZM Public Sans'
const FONT_ID = 'lzm-font-lz-lower-third'
const LATIN = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'
const LATIN_EXT = 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF'

// @font-face does not work inside a shadow root, so the face is declared on the document.
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
  await Promise.all(['400', '700', '800'].map((w) => document.fonts.load(`${w} 24px '${FONT}'`, sample))).catch(() => {})
}

const DEFAULTS = { name: 'Petra Beispiel', title: 'Geschäftsführung · Musterfirma GmbH', extra: '', position: 'left', accentDot: true, style: 'plate' }
const IN_MS = 650 // edge 0–300 ms, plate 200–650 ms
const OUT_MS = 700 // plate 0–450 ms, edge 300–600 ms
const FADE_MS = 150

const CSS = `
:host { position: absolute; inset: 0; display: block; overflow: hidden; pointer-events: none;
  --u: 1px; --ease: cubic-bezier(.2,.8,.2,1); --navy: rgba(29, 50, 79, .92); --tally: #D6402E; --steel: #8C9CB3; --ice: #E1ECEF;
  font-family: '${FONT}', 'Public Sans', system-ui, 'Segoe UI', Roboto, Arial, sans-serif; }
.lt { position: absolute; left: calc(120 * var(--u)); bottom: calc(142 * var(--u)); display: flex; align-items: stretch; overflow: hidden; }
.lt.right { left: auto; right: calc(120 * var(--u)); flex-direction: row-reverse; }
.edge { flex: none; width: calc(6 * var(--u)); background: var(--tally); transform: scaleY(0); transform-origin: bottom;
  transition: transform 300ms var(--ease) 300ms; }
.lt.in .edge { transform: scaleY(1); transition-delay: 0ms; }
.lt.no-accent .edge { background: var(--steel); }
.box { flex: none; box-sizing: border-box; min-height: calc(112 * var(--u)); padding: calc(16 * var(--u)) calc(30 * var(--u));
  display: flex; align-items: center; overflow: hidden; background: var(--navy); transform: translateX(calc(-100% - 6 * var(--u)));
  transition: transform 450ms var(--ease) 0ms, width 300ms var(--ease) 0ms; }
.lt.right .box { transform: translateX(calc(100% + 6 * var(--u))); }
/* Open: the box carries the dot in its left padding and slides fully out of the clip. */
.lt.open .box { transform: translateX(-100%); }
.lt.open.right .box { transform: translateX(100%); }
.lt.open.in .box { transform: none; }
.lt.in .box { transform: none; transition-delay: 200ms, 0ms; }
.content { flex: none; width: max-content; max-width: calc(1600 * var(--u)); position: relative; transition: opacity ${FADE_MS}ms linear; }
.line { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.name { font-weight: 800; font-size: calc(40 * var(--u)); line-height: 1.15; color: #fff; }
.title { font-weight: 400; font-size: calc(24 * var(--u)); line-height: 1.25; color: var(--ice); letter-spacing: calc(2 * var(--u)); margin-top: calc(6 * var(--u)); }
.extra { font-weight: 700; font-size: calc(16 * var(--u)); line-height: 1.3; color: var(--steel); letter-spacing: .18em; text-transform: uppercase; margin-top: calc(8 * var(--u)); }
.rule, .dot { display: none; }

/* Open style: line, tally dot, text without plate. The block starts 28 units left of the text for the dot. */
.lt.open { flex-direction: column; align-items: flex-start; left: calc(92 * var(--u)); }
.lt.open.right { left: auto; right: calc(120 * var(--u)); align-items: flex-end; }
.lt.open .edge { display: none; }
.lt.open .rule { display: block; flex: none; width: calc(72 * var(--u)); height: calc(5 * var(--u)); margin: 0 0 calc(20 * var(--u)) calc(28 * var(--u));
  background: var(--steel); transform: scaleX(0); transform-origin: left; transition: transform 300ms var(--ease) 300ms; }
.lt.open.right .rule { align-self: flex-start; }
.lt.open.in .rule { transform: scaleX(1); transition-delay: 0ms; }
.lt.open .box { background: transparent; min-height: 0; padding: 0 0 0 calc(28 * var(--u)); }
.lt.open .name { font-size: calc(44 * var(--u)); }
.lt.open .title { font-size: calc(26 * var(--u)); }
.lt.open .dot { display: block; position: absolute; left: calc(-28 * var(--u)); top: calc(18 * var(--u)); width: calc(14 * var(--u)); height: calc(14 * var(--u));
  background: var(--tally); transform: skewX(-8.7deg); }
.lt.open.no-accent .dot { display: none; }

.instant, .instant * { transition: none !important; }
[hidden] { display: none !important; }
`

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

class LowerThird extends HTMLElement {
  constructor() {
    super()
    this.data = { ...DEFAULTS }
    this.currentStep = undefined
    this.visible = false
    this.size = { width: 1920, height: 1080 }
    this.onResize = () => this.layout()
  }

  async load({ data, renderType, renderCharacteristics } = {}) {
    if (renderType && renderType !== 'realtime') return { statusCode: 400, statusMessage: 'Only real-time rendering is supported' }
    this.data = { ...DEFAULTS, ...(data ?? {}) }
    const res = renderCharacteristics?.resolution
    if (res?.width && res?.height) this.size = { width: res.width, height: res.height }
    ensureFontFace()
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' })
    root.innerHTML = `<style>${CSS}</style>
      <div class="lt"><div class="rule"></div><div class="edge"></div>
        <div class="box"><div class="content"><div class="dot"></div>
          <div class="line name"></div><div class="line title"></div><div class="line extra"></div></div></div></div>`
    this.lt = root.querySelector('.lt')
    this.box = root.querySelector('.box')
    this.content = root.querySelector('.content')
    this.lines = { name: root.querySelector('.name'), title: root.querySelector('.title'), extra: root.querySelector('.extra') }
    this.currentStep = undefined
    this.visible = false
    window.addEventListener('resize', this.onResize)
    await fontsReady(this.allText())
    this.applyText()
    this.applyLayoutClasses()
    this.layout()
    return { statusCode: 200 }
  }

  async dispose() {
    window.removeEventListener('resize', this.onResize)
    if (this.shadowRoot) this.shadowRoot.innerHTML = ''
    this.currentStep = undefined
    this.visible = false
    return { statusCode: 200 }
  }

  async playAction({ goto, delta, skipAnimation } = {}) {
    let target = Number.isInteger(goto) && goto >= 0 ? goto : (this.currentStep ?? -1) + (Number.isInteger(delta) ? delta : 1)
    if (target >= 1) {
      // Beyond the only step: go to the end.
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
    const relayout = prev.position !== this.data.position || prev.style !== this.data.style
    if (!this.visible || skipAnimation) {
      this.instant(() => {
        this.applyText()
        this.applyLayoutClasses()
        this.layout()
      })
      return { statusCode: 200 }
    }
    if (relayout) {
      // Position or style changed on air: out, rearrange, in.
      await this.setVisible(false, false)
      this.applyText()
      this.applyLayoutClasses()
      this.instant(() => this.layout())
      await this.setVisible(true, false)
      return { statusCode: 200 }
    }
    this.applyLayoutClasses() // accent on/off
    if (this.textChanged(prev)) {
      this.content.style.opacity = '0'
      await wait(FADE_MS)
      this.applyText()
      this.layout() // plate width follows (300 ms)
      this.content.style.opacity = '1'
      await wait(300)
    }
    return { statusCode: 200 }
  }

  async customAction({ id } = {}) {
    return { statusCode: 404, statusMessage: `Unknown custom action "${id}"` }
  }

  // ---------------------------------------------------------------------------------------------

  allText() {
    return `${this.data.name}${this.data.title}${this.data.extra}`
  }

  textChanged(prev) {
    return prev.name !== this.data.name || prev.title !== this.data.title || prev.extra !== this.data.extra
  }

  applyText() {
    for (const key of ['name', 'title', 'extra']) {
      const value = String(this.data[key] ?? '')
      this.lines[key].textContent = value
      this.lines[key].hidden = !value
    }
  }

  applyLayoutClasses() {
    const d = this.data
    this.lt.classList.toggle('right', d.position === 'right')
    this.lt.classList.toggle('open', d.style === 'open')
    this.lt.classList.toggle('no-accent', d.accentDot === false)
  }

  /** Scale to the output and size the plate to its text. */
  layout() {
    const w = this.size.width || this.clientWidth || 1920
    const h = this.size.height || this.clientHeight || 1080
    this.style.setProperty('--u', `${Math.min(w / 1920, h / 1080)}px`)
    if (!this.box) return
    const cs = getComputedStyle(this.box)
    const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
    this.box.style.width = `${Math.ceil(this.content.offsetWidth + pad)}px`
  }

  instant(fn) {
    this.lt.classList.add('instant')
    fn()
    void this.lt.offsetWidth // apply without transitions
    this.lt.classList.remove('instant')
  }

  async setVisible(on, skipAnimation) {
    if (!this.lt) return
    const changed = this.visible !== on
    this.visible = on
    if (skipAnimation) {
      this.instant(() => this.lt.classList.toggle('in', on))
      return
    }
    this.lt.classList.toggle('in', on)
    if (changed) await wait(on ? IN_MS : OUT_MS)
  }
}

export default LowerThird
