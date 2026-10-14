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

  // Shell, tabs, shortcuts
  'Automation and graphics': 'Automatik und Grafik',
  'More controls': 'Weitere Bedienung',
  Mics: 'Mikros',
  VFA: 'VFA',
  On: 'An',
  Close: 'Schließen',
  Add: 'Hinzufügen',
  'Keyboard shortcuts': 'Tastenkürzel',
  'Input to preview': 'Eingang auf Vorschau',
  'Input straight to programme': 'Eingang direkt auf Programm',
  'Auto transition': 'Auto-Übergang',
  'Fade to black': 'Abblende auf Schwarz',
  'Video follows audio on/off': 'Video folgt Audio an/aus',
  'Graphics layer 1: in, then next step': 'Grafikebene 1: ein, danach nächster Schritt',
  'Graphics layer 1: out': 'Grafikebene 1: aus',
  'Show shortcuts': 'Tastenkürzel zeigen',
  Space: 'Leertaste',
  Enter: 'Eingabe',
  'Shortcuts are off while you type in a field.': 'Beim Tippen in einem Feld sind die Tastenkürzel aus.',

  // Microphones
  Microphones: 'Mikrofone',
  Mic: 'Mikro',
  Unused: 'Unbenutzt',
  Device: 'Gerät',
  'No device': 'Kein Gerät',
  missing: 'fehlt',
  Channel: 'Kanal',
  Ch: 'Kanal',
  PGM: 'PGM',
  PVW: 'PVW',
  'Choose a device first': 'Erst ein Gerät wählen',
  'Mixed into the programme audio. Off: only steers video follows audio.': 'Wird ins Programm-Audio gemischt. Aus: steuert nur „Video folgt Audio“.',
  'Look for audio devices again': 'Audiogeräte neu suchen',
  'Refresh devices': 'Geräte neu suchen',
  'No audio devices found. Connect an interface and refresh.': 'Keine Audiogeräte gefunden. Interface anschließen und neu suchen.',

  // Video follows audio
  'Video follows audio': 'Video folgt Audio',
  'Video follows audio (V)': 'Video folgt Audio (V)',
  'On: cuts to whoever speaks': 'An: schneidet auf die Person, die spricht',
  'Off: manual cutting': 'Aus: Schnitt von Hand',
  Now: 'Jetzt',
  Nobody: 'Niemand',
  'Nobody is speaking': 'Niemand spricht',
  'Wide shot': 'Totale',
  audio: 'Ton',
  'Who is on which camera': 'Wer ist auf welcher Kamera',
  'No rules yet. Add one per speaker: their mic and the camera that shows them.': 'Noch keine Regeln. Eine pro Person anlegen: ihr Mikro und die Kamera, die sie zeigt.',
  'Audio source': 'Tonquelle',
  Camera: 'Kamera',
  'Add rule': 'Regel hinzufügen',
  'Remove rule': 'Regel entfernen',
  Speaking: 'Spricht',
  Holding: 'Hält',
  'Still the chosen speaker during a pause': 'Bleibt in einer Sprechpause die gewählte Person',
  'Timing and levels': 'Zeiten und Pegel',
  'Podcast 2 people': 'Podcast 2 Personen',
  'Podcast 3 people': 'Podcast 3 Personen',
  Panel: 'Podiumsrunde',
  Threshold: 'Schwelle',
  'Speech below this level is ignored': 'Sprache unter diesem Pegel zählt nicht',
  Dominance: 'Vorsprung',
  'How much louder than everyone else a speaker must be': 'So viel lauter als alle anderen muss eine Person sein',
  Attack: 'Ansprechzeit',
  'How long someone must speak before the cut': 'So lange muss jemand sprechen, bevor geschnitten wird',
  'Minimum shot': 'Mindestlänge',
  'A shot stays at least this long': 'So lange bleibt eine Einstellung mindestens stehen',
  'Silence to wide': 'Stille bis Totale',
  'Silence this long goes to the wide shot': 'Nach so viel Stille geht es auf die Totale',
  'Maximum shot': 'Höchstlänge',
  'A single speaker this long gets a wide break': 'Spricht eine Person so lange, kommt kurz die Totale',
  'Wide break': 'Totale-Pause',
  'How long the wide break lasts': 'So lange bleibt die Totale dazwischen',
  'Switch with': 'Umschalten mit',
  'Selected transition': 'Gewähltem Übergang',

  // Graphics
  Graphics: 'Grafik',
  Graphic: 'Grafik',
  Layer: 'Ebene',
  Loaded: 'Geladen',
  Loading: 'Lädt',
  Step: 'Schritt',
  'Loaded on this layer': 'Auf dieser Ebene geladen',
  'No graphics': 'Keine Grafiken',
  Load: 'Laden',
  Next: 'Weiter',
  Update: 'Aktualisieren',
  Clear: 'Leeren',
  'Take in (G)': 'Einblenden (G)',
  'Next step (G)': 'Nächster Schritt (G)',
  'Take out (H)': 'Ausblenden (H)',
  'Loading replaces the graphic that is on air': 'Laden ersetzt die Grafik, die gerade on air ist',
  'Send the form to the loaded graphic': 'Formular an die geladene Grafik schicken',
  'The form differs from what the layer shows. Update sends it.': 'Das Formular weicht von der Ebene ab. „Aktualisieren“ schickt es.',
  'Actions of this graphic': 'Aktionen dieser Grafik',
  'Renderer connected': 'Renderer verbunden',
  'Renderer not connected': 'Renderer nicht verbunden',
  'Read the graphics folders again': 'Grafikordner neu einlesen',
  Rescan: 'Neu einlesen',
  'Start the graphics renderer to load and play graphics. Layers keep their last picture.': 'Zum Laden und Abspielen den Grafik-Renderer starten. Die Ebenen behalten ihr letztes Bild.',
  'No graphics found. Put OGraf graphics into Documents/LZ Vision Mixer/Graphics and rescan.': 'Keine Grafiken gefunden. OGraf-Grafiken in Dokumente/LZ Vision Mixer/Graphics legen und neu einlesen.',
  'Not valid JSON; the last valid value is kept.': 'Kein gültiges JSON; der letzte gültige Wert bleibt.',
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
