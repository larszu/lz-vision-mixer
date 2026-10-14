// LZ Lyrics – OGraf graphic. One step per slide, stepCount -1 (the song decides).

const DEFAULTS = {
  title: '',
  credit: '',
  slides: [],
  layout: 'fullscreen',
  showTranslation: true,
  showCredit: 'first',
  fontFamily: "'Public Sans', system-ui, 'Segoe UI', Roboto, Arial, sans-serif",
  textColor: '#ffffff',
  translationColor: '#c8c8c8',
  backdrop: 'transparent',
  uppercase: false,
};

const FADE_MS = 400;

const CSS = `
:host { position: absolute; inset: 0; display: block; container-type: size; overflow: hidden; }
.stage { position: absolute; inset: 0; transition: background-color ${FADE_MS}ms; }
.layer { position: absolute; display: flex; flex-direction: column; justify-content: center; align-items: center;
  text-align: center; opacity: 0; transition: opacity ${FADE_MS}ms ease; overflow: hidden; box-sizing: border-box; }
.layer.on { opacity: 1; }
.full .layer { inset: 6cqh 6cqw 9cqh 6cqw; }
.lower .layer { left: 8cqw; right: 8cqw; bottom: 6cqh; height: 24cqh; padding: 1.5cqh 3cqw;
  background: rgba(19,32,64,.85); border-left: .5cqh solid var(--accent, #D6402E); }
.lines { line-height: 1.2; text-shadow: 0 .08em .3em rgba(0,0,0,.8); }
.lines p { margin: 0; }
.lines .tr { font-style: italic; font-size: .72em; margin-bottom: .25em; }
.credit { position: absolute; left: 6cqw; right: 6cqw; bottom: 3cqh; font-size: 2.2cqh; opacity: 0;
  transition: opacity ${FADE_MS}ms; text-align: center; text-shadow: 0 1px 4px rgba(0,0,0,.8); }
.lower .credit { bottom: 1.5cqh; font-size: 1.8cqh; }
.credit.on { opacity: .85; }
.upper .lines { text-transform: uppercase; }
`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Only <b>, <i>, <u> survive from the song file.
const inline = (s) => esc(s).replace(/&lt;(\/?)(b|i|u)&gt;/g, '<$1$2>');

class LyricsGraphic extends HTMLElement {
  constructor() {
    super();
    this.data = { ...DEFAULTS };
    this.currentStep = undefined;
    this.blank = false;
    this.front = 0;
  }

  async load({ data, renderType } = {}) {
    if (renderType && renderType !== 'realtime') {
      return { statusCode: 400, statusMessage: 'Only realtime rendering is supported' };
    }
    this.data = { ...DEFAULTS, ...(data ?? {}) };
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style><div class="stage"><div class="layer"></div><div class="layer"></div><div class="credit"></div></div>`;
    this.stage = root.querySelector('.stage');
    this.layers = [...root.querySelectorAll('.layer')];
    this.creditEl = root.querySelector('.credit');
    this.currentStep = undefined;
    this.applyStyle();
    return { statusCode: 200 };
  }

  async dispose() {
    if (this.shadowRoot) this.shadowRoot.innerHTML = '';
    this.currentStep = undefined;
  }

  async playAction({ goto, delta, skipAnimation } = {}) {
    const count = this.data.slides.length;
    let target;
    if (Number.isInteger(goto) && goto >= 0) target = goto;
    else target = (this.currentStep ?? -1) + (Number.isInteger(delta) ? delta : 1);
    if (target < 0) target = 0;

    if (target >= count) {
      await this.show(null, skipAnimation);
      this.currentStep = undefined;
      return { statusCode: 200, currentStep: undefined };
    }
    this.currentStep = target;
    await this.show(target, skipAnimation);
    return { statusCode: 200, currentStep: target };
  }

  async stopAction({ skipAnimation } = {}) {
    await this.show(null, skipAnimation);
    this.currentStep = undefined;
    return { statusCode: 200 };
  }

  async updateAction({ data, skipAnimation } = {}) {
    this.data = { ...this.data, ...(data ?? {}) };
    this.applyStyle();
    if (this.currentStep !== undefined) {
      if (this.currentStep >= this.data.slides.length) this.currentStep = this.data.slides.length ? this.data.slides.length - 1 : undefined;
      await this.show(this.currentStep ?? null, skipAnimation);
    }
    return { statusCode: 200, currentStep: this.currentStep };
  }

  async customAction({ id, payload, skipAnimation } = {}) {
    if (id !== 'blank') return { statusCode: 404, statusMessage: `Unknown action ${id}` };
    this.blank = payload?.blank ?? !this.blank;
    await this.show(this.currentStep ?? null, skipAnimation);
    return { statusCode: 200, currentStep: this.currentStep };
  }

  applyStyle() {
    const d = this.data;
    this.stage.className = `stage ${d.layout === 'lowerthird' ? 'lower' : 'full'}${d.uppercase ? ' upper' : ''}`;
    this.stage.style.backgroundColor = d.backdrop || 'transparent';
    this.stage.style.fontFamily = d.fontFamily;
    this.stage.style.color = d.textColor;
  }

  async show(index, skipAnimation) {
    const d = this.data;
    const slide = index === null || this.blank ? null : d.slides[index];
    const back = this.layers[1 - this.front];
    const front = this.layers[this.front];
    const dur = skipAnimation ? '0ms' : `${FADE_MS}ms`;
    for (const el of [...this.layers, this.creditEl]) el.style.transitionDuration = dur;

    if (slide) {
      back.innerHTML = this.slideHtml(slide);
      this.fit(back);
      back.classList.add('on');
      front.classList.remove('on');
      this.front = 1 - this.front;
    } else {
      front.classList.remove('on');
      back.classList.remove('on');
    }

    const c = d.showCredit;
    const last = index === d.slides.length - 1;
    const credit = slide && d.credit && (c === 'always' || (c === 'first' && index === 0) || (c === 'last' && last));
    this.creditEl.textContent = d.credit;
    this.creditEl.classList.toggle('on', Boolean(credit));

    if (!skipAnimation) await wait(FADE_MS);
  }

  slideHtml(slide) {
    const [main = [], ...more] = slide.lines ?? [];
    const tr = this.data.showTranslation ? more : [];
    const rows = [];
    // Interleave main and translation line by line, like SongBeamer shows them.
    const n = Math.max(main.length, ...tr.map((t) => t.length));
    for (let i = 0; i < n; i++) {
      if (main[i] !== undefined) rows.push(`<p>${inline(main[i]) || '&nbsp;'}</p>`);
      for (const t of tr) if (t[i] !== undefined) rows.push(`<p class="tr" style="color:${esc(this.data.translationColor)}">${inline(t[i])}</p>`);
    }
    return `<div class="lines">${rows.join('')}</div>`;
  }

  // Shrinks the text until it fits the layer box.
  fit(layer) {
    const lines = layer.firstElementChild;
    const h = this.clientHeight || 1080;
    let size = h * (this.data.layout === 'lowerthird' ? 0.055 : 0.075);
    const min = h * 0.02;
    const cs = getComputedStyle(layer);
    const availH = layer.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const availW = layer.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    lines.style.fontSize = `${size}px`;
    while (size > min && (lines.offsetHeight > availH || lines.scrollWidth > availW)) {
      size *= 0.94;
      lines.style.fontSize = `${size}px`;
    }
  }
}

export default LyricsGraphic;
