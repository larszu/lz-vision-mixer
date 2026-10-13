# Control API

The engine listens on `http://127.0.0.1:4195` (change with `--listen`). The web UI, Companion and scripts all use the same API.

- `GET /` — web UI
- `GET /ws` — WebSocket. The server sends `{"type":"state","state":State}` on connect and after every change, and `{"type":"levels","levels":Levels}` about ten times per second. The client sends commands as JSON (`Command`, below). Replies to commands are `{"type":"error","message":string}` on failure, nothing on success (the next state shows the result).
- `POST /api/cmd` — body: one `Command`. Answers `200 {"ok":true}` or `400 {"error":string}`.
- `GET /api/state` — `State` as JSON.
- Shortcuts for Bitfocus Companion (Generic HTTP, GET): `/api/cut`, `/api/auto`, `/api/ftb`, `/api/preview/<slot>`, `/api/program/<slot>`, `/api/overlay/<index>/toggle`, `/api/tbar/<0..1>`.
- `GET /mjpeg/multiview` — multiview as MJPEG (multipart/x-mixed-replace), 1280×720, ~15 fps. Layout below.

Slots and overlays are numbered from 1 in the API and in the UI.

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
  audio: { volume: number /* 0..2, 1 = 0 dB */; muted: boolean; afv: boolean /* audio follows video */ }
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
  capabilities: { decklink: boolean; ndi: boolean; srt: boolean; st2110: boolean; encoders: string[] }
}

interface Levels {          // dBFS peak per channel, -90 = silence
  slots: Record<number, [number, number]>
  master: [number, number]
}

type Command =
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
  | { cmd: 'audio'; slot: number; volume?: number; muted?: boolean; afv?: boolean }
  | { cmd: 'master'; volume?: number; muted?: boolean }
  | { cmd: 'addOutput'; spec: string }
  | { cmd: 'removeOutput'; id: string }
```

## Source specs

| Spec | Source |
|---|---|
| `test:smpte`, `test:bars`, `test:ball`, `test:black`, `test:snow` | Test pattern (with 1 kHz tone for `smpte`/`bars`) |
| `decklink:<n>` | DeckLink input `n` (0-based device number), mode auto-detected |
| `ndi:<source name>` | NDI source (needs the NDI runtime and the GStreamer NDI plugin) |
| `srt://host:port?mode=listener` · `rtmp://…` · `rtsp://…` · `http(s)://…` | Network stream |
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

## Multiview layout (1280×720)

Top half: preview (left, 640×360) and programme (right, 640×360). Bottom half: slots 1–8 in two rows of four (320×180 each). The UI draws names and tally borders on top; the picture itself carries none.
