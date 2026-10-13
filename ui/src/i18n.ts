// Source language is English; German is the first translation.
import type { Need } from './helpers'
import type { OverlayTransition, TransitionKind } from './types'

const de: Record<string, string> = {
  // Header and connection
  Connected: 'Verbunden',
  'Connecting…': 'Verbinde …',
  'Disconnected, retrying in': 'Getrennt, neuer Versuch in',
  'Not connected to the engine': 'Keine Verbindung zur Engine',
  'Waiting for the engine…': 'Warte auf die Engine …',
  Language: 'Sprache',
  Theme: 'Darstellung',
  'System theme': 'Wie System',
  Dark: 'Dunkel',
  Light: 'Hell',
  Dismiss: 'Schließen',

  // Multiview and inputs
  Multiview: 'Multiview',
  'No multiview signal': 'Kein Multiview-Signal',
  'Click for preview, double-click to cut to program': 'Klick: Vorschau, Doppelklick: hart auf Programm',
  Preview: 'Vorschau',
  Program: 'Programm',
  Inputs: 'Eingänge',
  Input: 'Eingang',
  'Edit source': 'Quelle bearbeiten',
  'Cut straight to program': 'Hart auf Programm schneiden',
  Running: 'Läuft',
  Starting: 'Startet',
  Error: 'Fehler',
  Empty: 'Leer',
  Name: 'Name',
  Source: 'Quelle',
  Presets: 'Vorlagen',
  'Clear input': 'Eingang leeren',
  Cancel: 'Abbrechen',
  Apply: 'Übernehmen',
  'SMPTE bars': 'SMPTE-Balken',
  'Colour bars': 'Farbbalken',
  'Bouncing ball': 'Springender Ball',
  Black: 'Schwarz',
  Snow: 'Rauschen',
  'DeckLink 1': 'DeckLink 1',
  'DeckLink 2': 'DeckLink 2',
  'DeckLink 3': 'DeckLink 3',
  'DeckLink 4': 'DeckLink 4',
  'NDI source': 'NDI-Quelle',
  'SRT listener': 'SRT-Listener',
  'Video file': 'Videodatei',
  'Still image': 'Standbild',

  // Transition
  Transition: 'Übergang',
  Cut: 'Cut',
  Auto: 'Auto',
  'Cut (Space)': 'Cut (Leertaste)',
  'Auto (Enter)': 'Auto (Eingabe)',
  Type: 'Art',
  Duration: 'Dauer',
  Curve: 'Kurve',
  'Curve direction': 'Kurvenrichtung',
  In: 'Ein',
  Out: 'Aus',
  'In and out': 'Ein und aus',
  FTB: 'FTB',
  'Fade to black (F)': 'Abblende auf Schwarz (F)',
  'T-bar': 'T-Bar',
  Mix: 'Mix',
  Dip: 'Dip',
  'Push left': 'Schieben links',
  'Push right': 'Schieben rechts',
  'Slide left': 'Gleiten links',
  'Slide right': 'Gleiten rechts',
  Zoom: 'Zoom',

  // Overlays
  Overlays: 'Overlays',
  None: 'Keiner',
  'On air': 'On Air',
  Off: 'Aus',
  'Choose an input first': 'Erst einen Eingang wählen',
  'Position presets': 'Positionsvorlagen',
  Full: 'Vollbild',
  'PiP top right': 'BiB oben rechts',
  'PiP bottom left': 'BiB unten links',
  'Lower third': 'Bauchbinde',
  W: 'B',
  H: 'H',
  Fade: 'Blende',
  'Fly in from left': 'Von links',
  'Fly in from right': 'Von rechts',
  'Fly in from top': 'Von oben',
  'Fly in from bottom': 'Von unten',

  // Outputs
  Outputs: 'Ausgänge',
  'No outputs yet. Add one below.': 'Noch keine Ausgänge. Unten einen hinzufügen.',
  'New output': 'Neuer Ausgang',
  'Add output': 'Ausgang hinzufügen',
  Remove: 'Entfernen',
  'DeckLink 1 programme': 'DeckLink 1 Programm',
  'DeckLink 2 multiview': 'DeckLink 2 Multiview',
  'NDI programme': 'NDI Programm',
  'RTMP stream': 'RTMP-Stream',
  Recording: 'Aufnahme',
  'Needs DeckLink, not available on this engine': 'Braucht DeckLink, auf dieser Engine nicht vorhanden',
  'Needs NDI, not available on this engine': 'Braucht NDI, auf dieser Engine nicht vorhanden',
  'Needs SRT, not available on this engine': 'Braucht SRT, auf dieser Engine nicht vorhanden',
  'Needs a video encoder, none available on this engine': 'Braucht einen Video-Encoder, auf dieser Engine keiner vorhanden',

  // Audio
  Audio: 'Audio',
  Master: 'Summe',
  Volume: 'Lautstärke',
  Mute: 'Stumm',
  AFV: 'AFV',
  'Audio follows video': 'Audio folgt Video',
  'Double-click for 0 dB': 'Doppelklick für 0 dB',
}

function detect(): 'en' | 'de' {
  try {
    const saved = localStorage.getItem('lang')
    if (saved === 'en' || saved === 'de') return saved
  } catch {
    // storage blocked: use the browser language
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en'
}

let lang: 'en' | 'de' = detect()

export const getLang = () => lang
export function setLang(l: 'en' | 'de') {
  lang = l
  try {
    localStorage.setItem('lang', l)
  } catch {
    // ignore
  }
}

export function t(s: string): string {
  return lang === 'de' ? (de[s] ?? s) : s
}

export const deKeys = Object.keys(de)

export const kindLabels = (): Record<TransitionKind, string> => ({
  cut: t('Cut'),
  mix: t('Mix'),
  dip: t('Dip'),
  pushLeft: t('Push left'),
  pushRight: t('Push right'),
  slideLeft: t('Slide left'),
  slideRight: t('Slide right'),
  zoom: t('Zoom'),
})

export const overlayTransitionLabels = (): Record<OverlayTransition, string> => ({
  cut: t('Cut'),
  fade: t('Fade'),
  flyLeft: t('Fly in from left'),
  flyRight: t('Fly in from right'),
  flyTop: t('Fly in from top'),
  flyBottom: t('Fly in from bottom'),
  zoom: t('Zoom'),
})

export function needLabel(need: Need | undefined): string {
  switch (need) {
    case 'decklink':
      return t('Needs DeckLink, not available on this engine')
    case 'ndi':
      return t('Needs NDI, not available on this engine')
    case 'srt':
      return t('Needs SRT, not available on this engine')
    case 'encoder':
      return t('Needs a video encoder, none available on this engine')
    default:
      return ''
  }
}
