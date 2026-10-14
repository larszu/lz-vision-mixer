// Source language is English; German is the first translation.
import type { Need } from './helpers'
import type { TargetProblem } from './osc'
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
  'Screen capture is not available on this engine': 'Bildschirmaufnahme ist in dieser Engine nicht verfügbar',
  'WebRTC (WHEP) is not available on this engine': 'WebRTC (WHEP) ist in dieser Engine nicht verfügbar',

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
  'Mixed into the programme audio. Off: only steers video follows audio.': 'Wird ins Programm-Audio gemischt. Aus: steuert nur „Video folgt Audio“.',
  'Look for audio devices again': 'Audiogeräte neu suchen',
  'Refresh devices': 'Geräte neu suchen',
  'No audio devices found. Connect an interface and refresh.': 'Keine Audiogeräte gefunden. Interface anschließen und neu suchen.',
  'Channel strip': 'Kanalzug',
  'No processing': 'Ohne Bearbeitung',
  Delay: 'Verzögerung',
  'Lip-sync delay, 0 to 500 ms': 'Verzögerung für Lippensynchronität, 0 bis 500 ms',
  'Delay per input: lip sync, 0 to 500 ms.': 'Verzögerung je Eingang: für Lippensynchronität, 0 bis 500 ms.',
  'Speech (podcast)': 'Sprache (Podcast)',
  Denoise: 'Entrauschen',
  'Switching restarts the mic briefly': 'Umschalten startet das Mikro kurz neu',
  'High-pass': 'Hochpass',
  Frequency: 'Frequenz',
  'Cuts rumble and handling noise below this frequency': 'Schneidet Rumpeln und Griffgeräusche unter dieser Frequenz ab',
  Gate: 'Gate',
  Compressor: 'Kompressor',
  Range: 'Absenkung',
  Ratio: 'Verhältnis',
  Release: 'Rückstellzeit',
  Makeup: 'Aufholverstärkung',
  'Below this level the gate closes': 'Unter diesem Pegel schließt das Gate',
  'How much the closed gate lowers the level': 'So weit senkt das geschlossene Gate den Pegel ab',
  'Above this level the compressor works': 'Über diesem Pegel arbeitet der Kompressor',
  'Gain after the compressor': 'Verstärkung nach dem Kompressor',

  // Audio outputs
  'Audio interface': 'Audio-Interface',
  'Programme audio to an interface, headphones or a virtual device.': 'Programm-Audio auf ein Interface, einen Kopfhörer oder ein virtuelles Gerät.',
  'No audio outputs found.': 'Keine Audio-Ausgänge gefunden.',
  'already an output': 'schon ein Ausgang',
  'in use': 'belegt',

  // Settings, OSC
  Settings: 'Einstellungen',
  'Receives on': 'Empfängt auf',
  'The engine sets this at start (--osc host:port, or off).': 'Legt die Engine beim Start fest (--osc host:port oder off).',
  'Feedback targets': 'Rückmeldeziele',
  'Feedback target': 'Rückmeldeziel',
  'Tally, programme, preview and more go to these addresses when they change.': 'Tally, Programm, Vorschau und mehr gehen bei jeder Änderung an diese Adressen.',
  'New target': 'Neues Ziel',
  'OSC addresses': 'OSC-Adressen',
  'Numbers can be in the path or the first argument.': 'Zahlen können im Pfad oder im ersten Argument stehen.',
  'The mixer receives': 'Der Mischer empfängt',
  'The mixer sends': 'Der Mischer sendet',
  'Enter host:port': 'host:port eingeben',
  'Use host:port, e.g. 192.168.1.20:9000': 'Als host:port angeben, z. B. 192.168.1.20:9000',
  'Not a valid host name or IP address': 'Kein gültiger Hostname und keine gültige IP-Adresse',
  'Port must be 1 to 65535': 'Port muss zwischen 1 und 65535 liegen',
  'This target is already in the list': 'Dieses Ziel steht schon in der Liste',
  'Cut, auto transition, fade to black': 'Cut, Auto-Übergang, Abblende auf Schwarz',
  'Input to preview / hard cut to programme': 'Eingang auf Vorschau / hart auf Programm',
  'T-bar 0..1': 'T-Bar 0..1',
  'Overlay in or out': 'Overlay ein oder aus',
  'Graphics layer': 'Grafikebene',
  'Load a graphic, optionally with data': 'Grafik laden, wahlweise mit Daten',
  'Update the graphic on the layer': 'Grafik auf der Ebene aktualisieren',
  'Text for the captions graphic': 'Text für die Untertitel-Grafik',
  'Any API command': 'Beliebiger API-Befehl',
  'Input on programme / preview': 'Eingang auf Programm / Vorschau',
  '0 off, 1 preview, 2 programme': '0 aus, 1 Vorschau, 2 Programm',
  'Fade to black, transition running': 'Abblende auf Schwarz, Übergang läuft',
  'Video follows audio and who speaks': 'Video folgt Audio und wer spricht',
  'Overlay on air': 'Overlay on air',
  'Graphics layer state': 'Zustand der Grafikebene',

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

  // Adding and removing inputs and mics
  'Add input': 'Eingang hinzufügen',
  'Add empty input': 'Leeren Eingang hinzufügen',
  'Remove input': 'Eingang entfernen',
  'No inputs yet. Add one for each camera, file or stream.': 'Noch keine Eingänge. Einen pro Kamera, Datei oder Stream hinzufügen.',
  'This input is on air. Removing it takes it off the programme.': 'Dieser Eingang ist on air. Entfernen nimmt ihn aus dem Programm.',
  'The number stays free; overlays, VFA rules and the wide shot that use this input are cleared.':
    'Die Nummer bleibt frei; Overlays, VFA-Regeln und die Totale, die diesen Eingang nutzen, werden geleert.',
  rule: 'Regel',
  rules: 'Regeln',
  'Add mic': 'Mikro hinzufügen',
  'Remove mic': 'Mikro entfernen',
  'No mics yet. Add one per microphone channel.': 'Noch keine Mikros. Eins pro Mikrofonkanal hinzufügen.',
  'The number stays free; VFA rules that listen to this mic are cleared.': 'Die Nummer bleibt frei; VFA-Regeln, die auf dieses Mikro hören, werden gelöscht.',
  'Add an input first': 'Erst einen Eingang hinzufügen',
  'Forecast from the engine load, see Performance': 'Prognose aus der Auslastung der Engine, siehe Leistung',
  'First nine inputs to preview': 'Erste neun Eingänge auf Vorschau',
  'First nine inputs straight to programme': 'Erste neun Eingänge direkt auf Programm',

  // Source dialog
  'Source type': 'Quellenart',
  'Source spec': 'Quellangabe',
  'Custom spec': 'Eigene Angabe',
  'Custom spec: the engine reads it as typed below.': 'Eigene Angabe: Die Engine liest sie so, wie sie unten steht.',
  'Choose a source type.': 'Eine Quellenart wählen.',
  'Choose a source type, or add the input empty and choose later.': 'Eine Quellenart wählen oder den Eingang leer hinzufügen und später wählen.',
  'Fill in the fields above': 'Felder oben ausfüllen',
  'From the source if empty': 'Leer: aus der Quelle',
  'Keeps the input and its number, without a source': 'Behält den Eingang und seine Nummer, ohne Quelle',
  'Choose…': 'Wählen …',
  'None found': 'Keine gefunden',
  'not available': 'nicht vorhanden',
  'Browse…': 'Durchsuchen …',
  'Waiting for the dialog…': 'Warte auf den Dialog …',
  'Nothing chosen.': 'Nichts gewählt.',
  'Opens on the computer running the engine.': 'Öffnet sich auf dem Rechner, auf dem die Engine läuft.',
  'Choose where to record. Opens on the computer running the engine.': 'Speicherort der Aufnahme wählen. Öffnet sich auf dem Rechner, auf dem die Engine läuft.',
  'Look for cameras and audio devices again': 'Kameras und Audiogeräte neu suchen',
  Sound: 'Ton',
  'From the device, if it has any': 'Vom Gerät selbst, falls vorhanden',
  'No cameras or capture cards found. Connect one and refresh.': 'Keine Kameras oder Capture-Karten gefunden. Eine anschließen und neu suchen.',
  Display: 'Bildschirm',
  main: 'Hauptbildschirm',
  Port: 'Port',
  Host: 'Host',
  'Address (multicast or 0.0.0.0)': 'Adresse (Multicast oder 0.0.0.0)',
  URL: 'URL',
  File: 'Datei',
  Folder: 'Ordner',
  'Source name': 'Quellname',
  'Cameras & capture': 'Kameras & Capture',
  Screen: 'Bildschirm',
  Network: 'Netzwerk',
  Files: 'Dateien',
  DeckLink: 'DeckLink',
  NDI: 'NDI',
  'Test patterns': 'Testbilder',
  'Test pattern': 'Testbild',
  'Camera or capture card': 'Kamera oder Capture-Karte',
  'USB camera, HDMI or SDI capture; sound optionally from an audio device': 'USB-Kamera, HDMI- oder SDI-Capture; Ton wahlweise von einem Audiogerät',
  'Screen capture': 'Bildschirmaufnahme',
  'A display of the engine computer': 'Ein Bildschirm des Engine-Rechners',
  'The mixer waits on a port; the sender connects to it': 'Der Mischer wartet auf einem Port; der Sender verbindet sich dorthin',
  'SRT caller': 'SRT-Caller',
  'The mixer connects to a sender that listens': 'Der Mischer verbindet sich mit einem Sender, der wartet',
  RTMP: 'RTMP',
  'Pulls a stream from an RTMP server': 'Holt einen Stream von einem RTMP-Server',
  RTSP: 'RTSP',
  'IP cameras and RTSP servers': 'IP-Kameras und RTSP-Server',
  'UDP MPEG-TS': 'UDP MPEG-TS',
  'Transport stream on a UDP port, also multicast': 'Transportstrom auf einem UDP-Port, auch Multicast',
  'HLS / DASH URL': 'HLS-/DASH-URL',
  'http(s) stream, also .m3u8 and .mpd': 'http(s)-Stream, auch .m3u8 und .mpd',
  'WebRTC (WHEP)': 'WebRTC (WHEP)',
  'WHEP endpoint of OBS, vMix or a WebRTC server': 'WHEP-Endpunkt von OBS, vMix oder einem WebRTC-Server',
  'SMPTE ST 2110': 'SMPTE ST 2110',
  'Reserved; needs the Intel Media Transport Library plugin': 'Vorgemerkt; braucht das Plugin der Intel Media Transport Library',
  'Plays in a loop': 'Läuft in Schleife',
  'PNG, JPEG and other images': 'PNG, JPEG und andere Bilder',
  'Watch folder': 'Überwachter Ordner',
  'Shows the newest image in a folder and switches when a newer one arrives': 'Zeigt das neueste Bild eines Ordners und wechselt, sobald ein neueres kommt',
  'SDP file': 'SDP-Datei',
  'RTP stream described by an SDP file, also AES67 audio': 'RTP-Stream aus einer SDP-Datei, auch AES67-Audio',
  'DeckLink input': 'DeckLink-Eingang',
  'Video mode is detected automatically': 'Das Videoformat wird automatisch erkannt',
  'Source name as shown in NDI tools, e.g. MACHINE (Camera 1)': 'Quellname wie in den NDI-Tools, z. B. RECHNER (Kamera 1)',
  'SMPTE and colour bars come with a 1 kHz tone': 'SMPTE- und Farbbalken kommen mit 1-kHz-Ton',
  'Needs SMPTE ST 2110 support, not available on this engine': 'Braucht SMPTE-ST-2110-Unterstützung, auf dieser Engine nicht vorhanden',

  // Performance
  Performance: 'Leistung',
  CPU: 'CPU',
  'whole machine': 'ganzer Rechner',
  Mixer: 'Mischer',
  'Other programs': 'Andere Programme',
  Limit: 'Grenze',
  Memory: 'Arbeitsspeicher',
  Output: 'Ausgabe',
  Cores: 'Kerne',
  input: 'Eingang',
  inputs: 'Eingänge',
  mic: 'Mikro',
  mics: 'Mikros',
  Forecast: 'Prognose',
  'Running smoothly': 'Läuft rund',
  'Machine busy': 'Rechner stark ausgelastet',
  'Output dips below the frame rate': 'Ausgabe fällt unter die Bildrate',
  'Overloaded: frames are dropped': 'Überlastet: Bilder fallen aus',
  'No room for more': 'Kein Platz für mehr',
  'Room for ~{n} more': 'Platz für ~{n} weitere',
  'No forecast yet.': 'Noch keine Prognose.',
  'The machine is full: no more inputs or mics fit.': 'Der Rechner ist voll: Es passen keine weiteren Eingänge oder Mikros.',
  '{n} more input': '{n} weiterer Eingang',
  '{n} more inputs': '{n} weitere Eingänge',
  '{n} more mic': '{n} weiteres Mikro',
  '{n} more mics': '{n} weitere Mikros',
  'About {inputs} and {mics} fit.': 'Etwa {inputs} und {mics} passen noch.',
  'One input costs about {input} % of one core, one mic about {mic} %.': 'Ein Eingang kostet etwa {input} % eines Kerns, ein Mikro etwa {mic} %.',
  'Measured on this machine': 'Auf diesem Rechner gemessen',
  Estimate: 'Schätzung',
  'The costs are learned from this machine while the engine runs, also from earlier runs, and get more exact as inputs come and go.':
    'Die Kosten lernt die Engine auf diesem Rechner, während sie läuft, auch aus früheren Läufen, und sie werden genauer, wenn Eingänge dazukommen oder wegfallen.',
  'Not measured yet: these are default costs. The engine learns the real ones on this machine once the number of running inputs changes, and refines them from then on.':
    'Noch nicht gemessen: Das sind Standardwerte. Die echten Kosten lernt die Engine auf diesem Rechner, sobald sich die Zahl laufender Eingänge ändert, und verfeinert sie danach laufend.',
  'Room counts up to 80 % of the whole machine, other programs included.': 'Gerechnet wird bis 80 % des ganzen Rechners, andere Programme eingeschlossen.',
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
    case 'st2110':
      return t('Needs SMPTE ST 2110 support, not available on this engine')
    case 'encoder':
      return t('Needs a video encoder, none available on this engine')
    case 'screen':
      return t('Screen capture is not available on this engine')
    case 'whep':
      return t('WebRTC (WHEP) is not available on this engine')
    default:
      return ''
  }
}

export function oscProblemLabel(p: TargetProblem): string {
  switch (p) {
    case 'empty':
      return t('Enter host:port')
    case 'format':
      return t('Use host:port, e.g. 192.168.1.20:9000')
    case 'host':
      return t('Not a valid host name or IP address')
    case 'port':
      return t('Port must be 1 to 65535')
    case 'duplicate':
      return t('This target is already in the list')
  }
}
