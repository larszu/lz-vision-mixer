// UI strings of the status window. English is the source, German the first translation.

export const en = {
  title: 'Graphics renderer',
  themeAuto: 'Auto',
  themeLight: 'Light',
  themeDark: 'Dark',
  engine: 'Engine',
  connected: 'Connected',
  waiting: 'Waiting for engine',
  noFormat: 'No format yet – the engine sends it after connecting.',
  format: 'Format {w} × {h} at {fps} fps',
  layers: 'Layers',
  noLayers: 'Layers appear once the engine is connected.',
  layer: 'Layer {n}',
  showPreview: 'Show preview',
  frames: '{sent} frames sent, {dropped} skipped',
  frameSocket: 'frame socket',
  frameSocketDown: 'frame socket not connected',
  step: 'step {n}',
  library: 'Library',
  rescan: 'Rescan',
  openFolder: 'Open folder',
  noGraphics: 'No graphics found.',
  steps: '{n} steps',
  dynamicSteps: 'dynamic steps',
  warnings: '{n} notes from the scan',
  folders: 'Graphics folders',
  'status.empty': 'Empty',
  'status.loading': 'Loading',
  'status.ready': 'Ready',
  'status.playing': 'On air',
  'status.stopped': 'Stopped',
  'status.error': 'Error',
} as const

export type Key = keyof typeof en

export const de: Record<Key, string> = {
  title: 'Grafik-Renderer',
  themeAuto: 'Auto',
  themeLight: 'Hell',
  themeDark: 'Dunkel',
  engine: 'Engine',
  connected: 'Verbunden',
  waiting: 'Warte auf die Engine',
  noFormat: 'Noch kein Format – die Engine sendet es nach dem Verbinden.',
  format: 'Format {w} × {h} mit {fps} fps',
  layers: 'Ebenen',
  noLayers: 'Die Ebenen erscheinen, sobald die Engine verbunden ist.',
  layer: 'Ebene {n}',
  showPreview: 'Vorschau zeigen',
  frames: '{sent} Bilder gesendet, {dropped} übersprungen',
  frameSocket: 'Bildverbindung',
  frameSocketDown: 'Bildverbindung getrennt',
  step: 'Schritt {n}',
  library: 'Bibliothek',
  rescan: 'Neu einlesen',
  openFolder: 'Ordner öffnen',
  noGraphics: 'Keine Grafiken gefunden.',
  steps: '{n} Schritte',
  dynamicSteps: 'variable Schritte',
  warnings: '{n} Hinweise beim Einlesen',
  folders: 'Grafikordner',
  'status.empty': 'Leer',
  'status.loading': 'Lädt',
  'status.ready': 'Bereit',
  'status.playing': 'On Air',
  'status.stopped': 'Gestoppt',
  'status.error': 'Fehler',
}

export function translator(lang: string): (key: Key, vars?: Record<string, string | number>) => string {
  const dict: Record<Key, string> = lang.toLowerCase().startsWith('de') ? de : en
  return (key, vars) => {
    let s = dict[key] ?? en[key]
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
    return s
  }
}
