# Control API

The engine listens on `http://127.0.0.1:4195` (change with `--listen`). The web UI, Companion and scripts all use the same API.

- `GET /` — web UI
- `GET /ws` — WebSocket. The server sends `{"type":"state","state":State}` on connect and after every change, and `{"type":"levels","levels":Levels}` about ten times per second. The client sends commands as JSON (`Command`, below). Replies to commands are `{"type":"error","message":string}` on failure, nothing on success (the next state shows the result).
- `POST /api/cmd` — body: one `Command`. Answers `200 {"ok":true}` or `400 {"error":string}`.
- `GET /api/state` — `State` as JSON.
- Shortcuts for Bitfocus Companion (Generic HTTP, GET): `/api/cut`, `/api/auto`, `/api/ftb`, `/api/preview/<slot>`, `/api/program/<slot>`, `/api/overlay/<index>/toggle`, `/api/tbar/<0..1>`.
- `GET /mjpeg/multiview` — multiview as MJPEG (multipart/x-mixed-replace), 1280×720, ~15 fps. Layout in `state.multiview`.
- `GET /api/perf` — `Perf` (below); also pushed over the WebSocket as `{"type":"perf","perf":Perf}` once a second.
- `POST /api/pick` — body `{ kind: 'video'|'image'|'folder'|'sdp'|'save' }`: opens the system's file dialog (Finder, Explorer, GTK via zenity) **on the engine's machine** — a browser on another device does not see it — and answers `{ path }`, `{ cancelled: true }`, or HTTP 400 `{ error }` (e.g. no dialog tool installed). The web UI uses it for file, image, folder and SDP sources and for recording paths.

Inputs and mics have stable numbers from 1; there is no fixed count. `addInput`/`addMic` take the next free number, removing one leaves a gap (numbers are never reused while running). Overlays are numbered 1 and 2.

## Types (TypeScript notation)

```ts
type EaseFamily = 'linear'|'sine'|'quad'|'cubic'|'quart'|'quint'|'expo'|'circ'|'back'|'elastic'|'bounce'
type EaseDirection = 'in'|'out'|'inOut'
interface Easing { family: EaseFamily; direction: EaseDirection }

type TransitionKind = 'cut'|'mix'|'dip'|'pushLeft'|'pushRight'|'slideLeft'|'slideRight'|'zoom'

interface Format { width: number; height: number; fps: number; name: string } // e.g. 1920, 1080, 50, "1080p50"

interface Slot {
  slot: number              // 1-based
  name: string              // user label, defaults to a name derived from the source
  spec: string | null       // source, see "Source specs"; null = empty slot (black)
  status: 'empty'|'starting'|'running'|'error'
  error: string | null
  audio: { volume: number /* 0..2, 1 = 0 dB */; muted: boolean; afv: boolean /* audio follows video */; delayMs: number /* 0..500 */ }
}

interface Rect { x: number; y: number; w: number; h: number } // normalised 0..1 of the frame, x/y = top-left

interface Overlay {
  index: number             // 1-based (1 and 2)
  slot: number | null
  onAir: boolean
  rect: Rect                // where the overlay sits; {0,0,1,1} = full frame (DSK), smaller = picture-in-picture
  transition: 'cut'|'fade'|'flyLeft'|'flyRight'|'flyTop'|'flyBottom'|'zoom'
  durationMs: number
}

interface Output {
  id: string
  spec: string              // see "Output specs"
  status: 'starting'|'running'|'error'
  error: string | null
}

interface State {
  version: string
  format: Format
  slots: Slot[]
  program: number | null
  preview: number | null
  transition: { kind: TransitionKind; durationMs: number; easing: Easing }
  inTransition: boolean
  tbar: number              // 0..1, 0 when idle
  ftb: boolean              // fade to black active (or fading)
  overlays: Overlay[]
  outputs: Output[]
  master: { volume: number; muted: boolean }
  capabilities: { decklink: boolean; ndi: boolean; screen: boolean; whep: boolean; srt: boolean; st2110: boolean; encoders: string[] }
  videoDevices: { id: string; name: string }[]   // cameras and capture cards, for `device:`
  multiview: {                // pixel layout of /mjpeg/multiview, for names and tally on top
    width: number; height: number
    preview: Area; program: Area
    tiles: (Area & { slot: number })[]   // one per input, in list order; more inputs → more columns
  }
}
interface Area { x: number; y: number; w: number; h: number }

interface Perf {
  cpu: number                 // engine, % of the whole machine
  systemCpu: number           // all programs, %
  cores: number
  memoryUsedMb: number; memoryTotalMb: number; processMemoryMb: number
  outputFps: number           // programme frames actually produced per second
  nominalFps: number
  overloaded: boolean         // output below 95 % of nominal for 2 s
  runningInputs: number; runningMics: number
  forecast: {
    moreInputs: number | null // how many more running inputs fit (machine below 80 % CPU)
    moreMics: number | null
    perInput: number          // cost of one, % of ONE core
    perMic: number
    basis: 'measured' | 'estimate'   // measured: learned on this machine (also from earlier runs)
  }
}

interface Levels {          // dBFS peak per channel, -90 = silence
  slots: Record<number, [number, number]>
  master: [number, number]
}

type Command =
  | { cmd: 'addInput'; spec?: string; name?: string }   // new input with the next number
  | { cmd: 'removeInput'; slot: number }                // not while it is in a running transition; clears programme/preview,
                                                        // overlays using it (taken off air), the wide shot and VFA rules with it
  | { cmd: 'addMic'; name?: string }
  | { cmd: 'removeMic'; mic: number }                   // also drops VFA rules that use the mic
  | { cmd: 'setInput'; slot: number; spec: string; name?: string }
  | { cmd: 'clearInput'; slot: number }
  | { cmd: 'renameInput'; slot: number; name: string }
  | { cmd: 'preview'; slot: number }
  | { cmd: 'program'; slot: number }          // hard cut straight to this slot
  | { cmd: 'cut' }
  | { cmd: 'auto' }                           // run the selected transition
  | { cmd: 'setTransition'; kind?: TransitionKind; durationMs?: number; easing?: Easing }
  | { cmd: 'tbar'; value: number }            // 0..1; reaching 1 completes the transition
  | { cmd: 'ftb' }                            // toggle fade to black (uses transition duration and easing)
  | { cmd: 'overlay'; index: number; slot?: number | null; rect?: Rect; transition?: Overlay['transition']; durationMs?: number }
  | { cmd: 'overlayOn'; index: number; on: boolean }   // animated
  | { cmd: 'audio'; slot: number; volume?: number; muted?: boolean; afv?: boolean; delayMs?: number }
  | { cmd: 'master'; volume?: number; muted?: boolean }
  | { cmd: 'addOutput'; spec: string }
  | { cmd: 'removeOutput'; id: string }
```

## Microphones (audio devices)

Besides the audio embedded in the inputs, the mixer takes any number of microphone channels from audio interfaces (CoreAudio, WASAPI, PulseAudio/PipeWire). Each mic is one channel of one device; the same device can feed several mics. Mics are mixed into the programme like inputs (fader, mute) unless `inProgram` is off — then they only steer video follows audio.

```ts
interface AudioDevice { id: string; name: string; channels: number }

interface Mic {
  mic: number               // stable number from 1, no fixed count
  name: string
  device: string | null     // AudioDevice.id; null = unused
  channel: number           // 0-based channel of the device
  status: 'empty'|'starting'|'running'|'error'
  error: string | null
  volume: number            // 0..2, 1 = 0 dB
  muted: boolean
  inProgram: boolean        // mixed into the programme audio
  delayMs: number           // lip-sync delay 0..500
  strip: Strip              // channel strip, see below
}

interface Strip {           // all optional in micStrip; missing fields stay as they are
  hpfHz: number             // high-pass corner 20..400 Hz, 0 = off
  gate: boolean; gateThresholdDb: number /* -90..0 */; gateRangeDb: number /* 0..90 */
  comp: boolean; compThresholdDb: number /* -60..0 */; compRatio: number /* 1..20 */
  compAttackMs: number /* 0.1..200 */; compReleaseMs: number /* 10..2000 */
  makeupDb: number          // -20..24
  denoise: boolean          // RNNoise speech denoising; switching it restarts the mic briefly
}
```

Defaults (neutral): `hpfHz 0, gate false, gateThresholdDb -50, gateRangeDb 20, comp false, compThresholdDb -20, compRatio 3, compAttackMs 10, compReleaseMs 150, makeupDb 0, denoise false`. Values outside the ranges are clamped; `hpfHz` above 0 and below 20 becomes 20. The strip runs in this order: denoise → high-pass (12 dB/oct Butterworth) → gate (120 ms hold) → compressor (soft knee) → makeup. Pre-fader speech levels for video follows audio are measured after the strip. Input slots have `audio.delayMs` too (command `audio` with `delayMs`).

State gains `audioDevices: AudioDevice[]` (inputs), `audioOutputs: AudioDevice[]` (outputs, for the `audio:` output) and `mics: Mic[]`. `refreshDevices` re-reads both. Every source always appears in `speech`; silence and unused sources are `-90`. `Levels` gains `mics: Record<number, number>` (peak dBFS, mono) and `speech: Record<string, number>` — pre-fader RMS in dBFS per VFA source (`"slot:3"`, `"mic:2"`), which is what video follows audio listens to.

Commands:
```ts
  | { cmd: 'setMic'; mic: number; device: string; channel: number; name?: string }
  | { cmd: 'clearMic'; mic: number }
  | { cmd: 'renameMic'; mic: number; name: string }
  | { cmd: 'micAudio'; mic: number; volume?: number; muted?: boolean; inProgram?: boolean; delayMs?: number }
  | { cmd: 'micStrip'; mic: number; strip: Partial<Strip> }
  | { cmd: 'refreshDevices' }
```

## Video follows audio (VFA)

Cuts to the camera of whoever speaks — for podcasts, talk rounds, panels. Each rule ties an audio source (an input's own audio or a mic) to a camera input. Decisions use pre-fader RMS levels ten times a second:

- A source **speaks** when it is above `thresholdDb` and at least `dominanceDb` louder than every other source (so bleed into the neighbour's mic does not count).
- A speaker must hold for `attackMs` before the mixer cuts (no cuts on a cough).
- A shot stays at least `minShotMs`.
- Two or more sources within `dominanceDb` of each other above the threshold (cross-talk), or silence longer than `silenceMs`, go to `wideSlot` (if set).
- With `maxShotMs` > 0, a single speaker held longer than that gets a cut to the wide shot for `wideBreakMs`, then back.
- Switching uses `transition`: `'cut'` or `'auto'` (the selected transition with its curve).
- A manual cut, auto or T-bar move restarts the minimum shot time; VFA keeps running. `enabled: false` stops it.

```ts
interface VfaRule { source: string /* "slot:N" | "mic:N" */; camera: number /* input slot */ }
interface Vfa {
  enabled: boolean
  rules: VfaRule[]
  wideSlot: number | null
  thresholdDb: number      // default -42
  dominanceDb: number      // default 6
  attackMs: number         // default 400
  minShotMs: number        // default 2500
  silenceMs: number        // default 2500
  maxShotMs: number        // default 0 = off
  wideBreakMs: number      // default 3000
  transition: 'cut' | 'auto'
  speaking: string | null  // source of the shot on air ("mic:2"), "wide", or null before the first decision;
                           // during a pause it keeps the last decision until silenceMs goes wide
}
```

State gains `vfa: Vfa`. Commands:
```ts
  | { cmd: 'setVfa'; enabled?: boolean; rules?: VfaRule[]; wideSlot?: number | null; thresholdDb?: number;
      dominanceDb?: number; attackMs?: number; minShotMs?: number; silenceMs?: number; maxShotMs?: number;
      wideBreakMs?: number; transition?: 'cut' | 'auto' }
```
Companion: `GET /api/vfa/on`, `/api/vfa/off`, `/api/vfa/toggle`.

## Graphics (EBU OGraf)

Two graphics layers sit above everything else in the programme (above the overlays, below fade to black). They play [EBU OGraf v1](https://github.com/ebu/ograf) graphics — lower thirds, bugs, titles — rendered with transparency by the **graphics renderer**, a separate small app (`renderer/`) that the engine starts or that connects on its own. Any OGraf graphic works, including the one from lz-presenter.

```ts
interface GraphicInfo {
  id: string               // manifest id
  name: string
  description: string
  path: string             // folder on the renderer machine
  schema: object | null    // the manifest's JSON schema for `data` (GDD), to build a form
  stepCount: number        // 1, n, or -1 (dynamic)
  customActions: { id: string; name: string; description?: string; schema?: object }[]
}
interface GraphicsLayer {
  layer: number            // 1..2
  graphicId: string | null
  data: object             // last data sent with load/update
  status: 'empty'|'loading'|'ready'|'playing'|'stopped'|'error'
  step: number             // current step (0-based) while playing
  error: string | null
}
interface Graphics { rendererConnected: boolean; library: GraphicInfo[]; layers: GraphicsLayer[] }
```

State gains `graphics: Graphics`. Commands:
```ts
  | { cmd: 'gfxLoad'; layer: number; graphicId: string; data?: object }   // loads, does not play
  | { cmd: 'gfxPlay'; layer: number; delta?: number; goto?: number; skipAnimation?: boolean } // OGraf playAction, params passed on unchanged
  | { cmd: 'gfxStop'; layer: number; skipAnimation?: boolean }            // OGraf stopAction
  | { cmd: 'gfxUpdate'; layer: number; data: object }                     // OGraf updateAction; allowed whenever a graphic is loaded
  | { cmd: 'gfxCustom'; layer: number; id: string; payload?: object }     // OGraf customAction
  | { cmd: 'gfxClear'; layer: number }                                    // dispose
  | { cmd: 'gfxRescan' }                                                  // re-read the graphics folders
```
Companion: `GET /api/gfx/<layer>/play`, `/api/gfx/<layer>/next` (play with delta 1), `/api/gfx/<layer>/stop`.

### Renderer protocol (engine ↔ renderer, local only)

- The renderer opens a WebSocket to `ws://127.0.0.1:4195/renderer`. The engine sends `{"type":"hello","format":{"width","height","fps"},"layers":2,"framePorts":[4198,4199]}`.
- For each layer the renderer connects a TCP socket to `127.0.0.1:<framePort>` and writes raw frames: BGRA, premultiplied = false, `width × height × 4` bytes each, back to back, no header. It sends a frame whenever the picture changes (and at least once after connecting); the engine holds the last frame. A fully transparent frame clears the layer.
- Engine → renderer: `{"type":"load","layer","graphicId","data"}`, `{"type":"play","layer","params":{delta?,goto?,skipAnimation?}}`, `{"type":"stop","layer","params":{skipAnimation?}}`, `{"type":"update","layer","data"}`, `{"type":"custom","layer","id","payload"}`, `{"type":"clear","layer"}`, `{"type":"rescan"}`.
- Renderer → engine: `{"type":"library","graphics":GraphicInfo[]}` (after connecting and after every rescan), `{"type":"layer","layer","graphicId","status","step","error"}` on every change.
- Graphics folders scanned by the renderer: its bundled `graphics/` folder, `~/Documents/LZ Vision Mixer/Graphics`, and any folders given with `--graphics <dir>`. A graphic is an `*.ograf.json` manifest with its files; a folder may hold several. When two graphics share an id, the later folder in this order wins. Before `load`, the renderer fills in the schema defaults under the data it receives; `GraphicsLayer.data` holds only what was sent. A `load` on a layer that is on air replaces the graphic with a hard cut. On every `hello` the renderer clears both layers.

## OSC

The engine receives OSC on UDP `127.0.0.1:4210` (`--osc 0.0.0.0:4210` for other machines, `--osc off`). Numbers can be in the path or the first argument; extra arguments are ignored (so the intercom's keyword rules, which append their text, work).

| Address | Does |
|---|---|
| `/lzvm/cut`, `/lzvm/auto`, `/lzvm/ftb` | as the commands |
| `/lzvm/preview/<n>`, `/lzvm/program/<n>` (or `… i`) | preview / hard cut |
| `/lzvm/tbar f` | T-bar 0..1 |
| `/lzvm/overlay/<i>/on` · `/off` · `/toggle` | overlay in/out |
| `/lzvm/vfa/on` · `/off` · `/toggle` | video follows audio |
| `/lzvm/gfx/<l>/play` · `/next` · `/stop` · `/clear` | graphics layer |
| `/lzvm/gfx/<l>/load s:graphicId [s:json data]` | load a graphic |
| `/lzvm/gfx/<l>/update s:json` | updateAction |
| `/lzvm/caption s:text [i:layer]` | Text for live captions: updateAction `{"text": …}` on the given layer, else the layer showing a captions graphic, else layer 2. If no captions graphic is loaded there, `lz-captions` is loaded with the text and played; if it is loaded but not playing, it is played. |
| `/lzvm/cmd s:json` | any API command |

Feedback goes to every target in `state.osc.targets` (`{ cmd: 'setOscTargets'; targets: string[] }`, "host:port"), only when a value changes: `/lzvm/program i`, `/lzvm/preview i`, `/lzvm/tally/<n> i` (0 off, 1 preview, 2 programme), `/lzvm/ftb i`, `/lzvm/transition i`, `/lzvm/vfa i`, `/lzvm/vfa/speaking s`, `/lzvm/overlay/<i> i`, `/lzvm/gfx/<l>/status s`, `/lzvm/gfx/<l>/onair i`. State gains `osc: { listen: string | null; targets: string[] }`.

## Source specs

| Spec | Source |
|---|---|
| `test:smpte`, `test:bars`, `test:ball`, `test:black`, `test:snow` | Test pattern (with 1 kHz tone for `smpte`/`bars`) |
| `device:<videoDevices.id>` · `device:<id>#audio=<audioDevices.id>` (ids may contain `:`; `#audio=` separates them) | Camera or capture card (USB, HDMI/SDI capture), optionally with sound from an audio device |
| `screen:<n>` | Screen capture of display n (0-based) |
| `sdp:/path/stream.sdp` | RTP stream described by an SDP file (also AES67 audio) |
| `whep:<endpoint URL>` | WebRTC via WHEP (e.g. from OBS, vMix, a WebRTC server) |
| `folder:/path` | Newest still image in a folder; switches when a newer one arrives |
| `decklink:<n>` | DeckLink input `n` (0-based device number), mode auto-detected |
| `ndi:<source name>` | NDI source (needs the NDI runtime and the GStreamer NDI plugin) |
| `srt://host:port?mode=listener` (or `caller`) · `rtmp://…` · `rtsp://…` · `rtsps://…` · `udp://…` (MPEG-TS) · `http(s)://…` (also HLS `.m3u8` and DASH `.mpd`) | Network stream; retried every 3 s when it drops |
| `file:/path/to/clip.mp4` | Video file, loops |
| `image:/path/to/still.png` | Still image |
| `st2110:<sdp file>` | Reserved; needs the Intel Media Transport Library plugin (not yet wired) |

## Output specs

| Spec | Output |
|---|---|
| `decklink:<n>` | Programme to DeckLink output `n`, video + embedded audio |
| `decklink-mv:<n>` | Multiview to DeckLink output `n` |
| `ndi:<name>` | Programme as NDI source |
| `srt://host:port?mode=listener` (or `caller`) | H.264/AAC in MPEG-TS over SRT |
| `rtmp://server/app/key` | H.264/AAC to an RTMP server (YouTube, Restream …) |
| `record:/path/file.mp4` | Recording, H.264/AAC (`.mov` → ProRes 422 HQ/PCM if available) |
| `audio:<AudioDevice.id>` | Programme audio to an audio interface, headphones or a virtual device (BlackHole, Dante Virtual Soundcard) — e.g. into the intercom's Program channel or for monitoring |

## Multiview layout (1280×720)

Top half: preview (left) and programme (right). Bottom half: every input as a tile; four columns up to eight inputs, more columns as more inputs come. Exact rectangles are in `state.multiview`. The UI draws names and tally borders on top; the picture itself carries none.
