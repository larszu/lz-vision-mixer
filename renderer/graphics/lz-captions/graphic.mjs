// LZ Captions – EBU OGraf v1 graphic, Lars Zumpe Medienproduktion design (Brand Guide 2.0:
// "Untertitel: Public Sans Bold, weiß, mittig unten, Navy-Fläche 90 %").
// Live captions: updateAction({ data: { text } }) sets the text (the engine's OSC /lzvm/caption).
// At most two lines inside the title-safe area; longer text keeps its last two lines. Text that only
// grows is updated in place, anything else cross-fades (out 120 ms, in 220 ms). The plate follows
// the text size. After autoHideS seconds without new text the plate fades out; new text brings it
// back. Ease-out cubic-bezier(.2,.8,.2,1), no movement longer than 450 ms. Layout at 1920 × 1080, scaled.

const FONT = 'LZM Public Sans'
const FONT_ID = 'lzm-font-lz-captions'
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
  await Promise.all(['700'].map((w) => document.fonts.load(`${w} 24px '${FONT}'`, sample))).catch(() => {})
}

const DEFAULTS = { text: '', speaker: '', autoHideS: 6, position: 'bottom' }
const SHOW_MS = 300
const HIDE_MS = 300
const OUT_MS = 120
const IN_MS = 220
const MAX_LINES = 2
const ELLIPSIS = '… '

const CSS = `
:host { position: absolute; inset: 0; display: block; overflow: hidden; pointer-events: none;
  --u: 1px; --ease: cubic-bezier(.2,.8,.2,1); --navy: rgba(29, 50, 79, .9); --steel: #8C9CB3;
  font-family: '${FONT}', 'Public Sans', system-ui, 'Segoe UI', Roboto, Arial, sans-serif; }
/* Title-safe area: 10 % of the height from the edge. */
.cap { position: absolute; left: 50%; bottom: calc(108 * var(--u)); box-sizing: border-box; overflow: hidden;
  padding: calc(14 * var(--u)) calc(32 * var(--u)); background: var(--navy);
  opacity: 0; transform: translate(-50%, calc(12 * var(--u)));
  transition: opacity ${HIDE_MS}ms var(--ease), transform ${SHOW_MS}ms var(--ease), width ${IN_MS}ms var(--ease), height ${IN_MS}ms var(--ease); }
.cap.top { bottom: auto; top: calc(108 * var(--u)); transform: translate(-50%, calc(-12 * var(--u))); }
.cap.in { opacity: 1; transform: translate(-50%, 0); }
.content { width: max-content; max-width: calc(1440 * var(--u)); text-align: center;
  transition: opacity ${IN_MS}ms var(--ease), transform ${IN_MS}ms var(--ease); }
.content.out { opacity: 0; transition: opacity ${OUT_MS}ms linear; }
.content.rise { transform: translateY(calc(6 * var(--u))); opacity: 0; transition: none; }
.speaker { font-weight: 700; font-size: calc(18 * var(--u)); line-height: 1.3; color: var(--steel); letter-spacing: .16em;
  text-transform: uppercase; margin-bottom: calc(4 * var(--u)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.text, .measure { font-weight: 700; font-size: calc(44 * var(--u)); line-height: 1.3; color: #fff; overflow-wrap: anywhere; }
.measure { position: absolute; visibility: hidden; left: 0; top: 0; width: calc(1440 * var(--u)); text-align: center; }
.instant, .instant * { transition: none !important; }
[hidden] { display: none !important; }
`

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

class Captions extends HTMLElement {
  constructor() {
    super()
    this.data = { ...DEFAULTS }
    this.currentStep = undefined
    this.playing = false
    this.shown = false
    this.shownText = ''
    this.shownSpeaker = ''
    this.hideTimer = null
    this.busy = null
    this.size = { width: 1920, height: 1080 }
    this.onResize = () => this.layout(true)
  }

  async load({ data, renderType, renderCharacteristics } = {}) {
    if (renderType && renderType !== 'realtime') return { statusCode: 400, statusMessage: 'Only real-time rendering is supported' }
    this.data = { ...DEFAULTS, ...(data ?? {}) }
    const res = renderCharacteristics?.resolution
    if (res?.width && res?.height) this.size = { width: res.width, height: res.height }
    ensureFontFace()
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' })
    root.innerHTML = `<style>${CSS}</style>
      <div class="cap"><div class="content"><div class="speaker"></div><div class="text"></div></div></div><div class="measure"></div>`
    this.cap = root.querySelector('.cap')
    this.content = root.querySelector('.content')
    this.speakerEl = root.querySelector('.speaker')
    this.textEl = root.querySelector('.text')
    this.measure = root.querySelector('.measure')
    this.currentStep = undefined
    this.playing = false
    this.shown = false
    window.addEventListener('resize', this.onResize)
    await fontsReady(this.data.text + this.data.speaker)
    this.setScale()
    this.instant(() => {
      this.applyPosition()
      this.applyText()
      this.layout()
    })
    return { statusCode: 200 }
  }

  async dispose() {
    window.removeEventListener('resize', this.onResize)
    clearTimeout(this.hideTimer)
    if (this.shadowRoot) this.shadowRoot.innerHTML = ''
    this.currentStep = undefined
    this.playing = false
    this.shown = false
    return { statusCode: 200 }
  }

  async playAction({ goto, delta, skipAnimation } = {}) {
    const target = Number.isInteger(goto) && goto >= 0 ? goto : (this.currentStep ?? -1) + (Number.isInteger(delta) ? delta : 1)
    if (target >= 1) {
      await this.stopAction({ skipAnimation })
      return { statusCode: 200, currentStep: undefined }
    }
    this.currentStep = 0
    this.playing = true
    this.armHide()
    await this.setShown(this.hasText(), skipAnimation)
    return { statusCode: 200, currentStep: 0 }
  }

  async stopAction({ skipAnimation } = {}) {
    this.playing = false
    this.currentStep = undefined
    clearTimeout(this.hideTimer)
    await this.setShown(false, skipAnimation)
    return { statusCode: 200 }
  }

  async updateAction({ data, skipAnimation } = {}) {
    const prev = this.data
    this.data = { ...this.data, ...(data ?? {}) }
    const d = this.data
    await fontsReady(String(d.text ?? '') + String(d.speaker ?? ''))
    const newText = String(prev.text ?? '') !== String(d.text ?? '') || String(prev.speaker ?? '') !== String(d.speaker ?? '')
    if (newText || prev.autoHideS !== d.autoHideS) this.armHide()

    if (!this.shown || skipAnimation) {
      this.instant(() => {
        this.applyPosition()
        this.applyText()
        this.layout()
      })
      if (this.playing && newText) await this.setShown(this.hasText(), skipAnimation)
      return { statusCode: 200 }
    }
    if (prev.position !== d.position) {
      // Moved on air: out, rearrange, in.
      await this.setShown(false, false)
      this.instant(() => {
        this.applyPosition()
        this.applyText()
        this.layout()
      })
      await this.setShown(this.hasText(), false)
      return { statusCode: 200 }
    }
    if (!this.hasText()) {
      await this.setShown(false, false)
      return { statusCode: 200 }
    }
    await this.swapText()
    return { statusCode: 200 }
  }

  async customAction({ id } = {}) {
    return { statusCode: 404, statusMessage: `Unknown custom action "${id}"` }
  }

  // ---------------------------------------------------------------------------------------------

  hasText() {
    return String(this.data.text ?? '').trim() !== ''
  }

  /** Coalesces fast updates: while a swap runs, only the latest text is shown next. */
  async swapText() {
    if (this.busy) {
      this.again = true
      return this.busy
    }
    this.busy = (async () => {
      do {
        this.again = false
        const fitted = this.fit(String(this.data.text ?? ''))
        const speaker = String(this.data.speaker ?? '').trim()
        if (fitted === this.shownText && speaker === this.shownSpeaker) continue
        // Text that only grows (live transcription) changes in place; anything else cross-fades.
        const grows = speaker === this.shownSpeaker && this.shownText !== '' && fitted.startsWith(this.shownText)
        if (grows) {
          this.applyText(fitted)
          this.layout()
          await wait(IN_MS)
          continue
        }
        this.content.classList.add('out')
        await wait(OUT_MS)
        this.content.classList.remove('out')
        this.content.classList.add('rise')
        this.applyText(fitted)
        this.layout()
        void this.content.offsetWidth
        this.content.classList.remove('rise')
        await wait(IN_MS)
      } while (this.again)
    })()
    try {
      await this.busy
    } finally {
      this.busy = null
    }
  }

  /** The last MAX_LINES lines of the text, with an ellipsis in front when something was dropped. */
  fit(raw) {
    const text = raw.replace(/\s+/g, ' ').trim()
    if (!text || !this.measure) return text
    const lineH = parseFloat(getComputedStyle(this.measure).lineHeight) || 57
    const fits = (s) => {
      this.measure.textContent = s
      return this.measure.offsetHeight <= lineH * MAX_LINES + 1
    }
    if (fits(text)) return text
    const words = text.split(' ')
    // Smallest start index whose tail fits; fewer words always fit at least as well.
    let lo = 1
    let hi = words.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (fits(ELLIPSIS + words.slice(mid).join(' '))) hi = mid
      else lo = mid + 1
    }
    return ELLIPSIS + words.slice(lo).join(' ')
  }

  applyText(fitted = this.fit(String(this.data.text ?? ''))) {
    const speaker = String(this.data.speaker ?? '').trim()
    this.textEl.textContent = fitted
    this.speakerEl.textContent = speaker
    this.speakerEl.hidden = !speaker
    this.shownText = fitted
    this.shownSpeaker = speaker
  }

  applyPosition() {
    this.cap.classList.toggle('top', this.data.position === 'top')
  }

  setScale() {
    const w = this.size.width || this.clientWidth || 1920
    const h = this.size.height || this.clientHeight || 1080
    this.style.setProperty('--u', `${Math.min(w / 1920, h / 1080)}px`)
  }

  /** Sizes the plate to its text, so width and height can transition. */
  layout(rescale) {
    if (!this.cap) return
    if (rescale) {
      this.setScale()
      this.applyText()
    }
    const cs = getComputedStyle(this.cap)
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
    this.cap.style.width = `${Math.ceil(this.content.offsetWidth + padX)}px`
    this.cap.style.height = `${Math.ceil(this.content.offsetHeight + padY)}px`
  }

  armHide() {
    clearTimeout(this.hideTimer)
    const s = Number(this.data.autoHideS)
    if (!this.playing || !(s > 0)) return
    this.hideTimer = setTimeout(() => {
      if (this.playing) this.setShown(false, false)
    }, s * 1000)
  }

  instant(fn) {
    this.cap.classList.add('instant')
    fn()
    void this.cap.offsetWidth // apply without transitions
    this.cap.classList.remove('instant')
  }

  async setShown(on, skipAnimation) {
    if (!this.cap) return
    const changed = this.shown !== on
    this.shown = on
    if (skipAnimation) {
      this.instant(() => this.cap.classList.toggle('in', on))
      return
    }
    this.cap.classList.toggle('in', on)
    if (changed) await wait(on ? SHOW_MS : HIDE_MS)
  }
}

export default Captions
