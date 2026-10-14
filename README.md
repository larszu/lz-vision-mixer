# LZ Vision Mixer

**Software vision mixer in the manner of vMix: as many inputs as the computer carries, preview/programme with eased transitions, video follows audio for podcasts and talk rounds, EBU OGraf graphics, overlays, multiview, and outputs to DeckLink SDI, NDI, SRT, RTMP and recording.** Engine in Rust on GStreamer, controlled from the browser, Bitfocus Companion or plain HTTP. macOS, Windows, Linux.

![Web UI](docs/ui.png)

![Lower third from the bundled OGraf graphic](docs/lower-third.png)

More views: [video follows audio](docs/ui-vfa.png) · [graphics](docs/ui-graphics.png) · [microphones](docs/ui-mics.png)

## What it does

- **As many inputs as the computer carries** — no fixed number: inputs and mics are added and removed while running. Each input has its own frame sync: every source is converted to the programme format (scaled with letterbox, frame rate matched) in a pipeline of its own. A source that fails shows black after a second and is retried every three seconds; the programme keeps running.
  - `test:smpte`, `test:bars`, `test:ball`, `test:black`, `test:snow`
  - `device:<camera or capture card>` — USB cameras, HDMI/SDI capture devices, built-in cameras; optionally with sound from an audio device
  - `decklink:<n>` — DeckLink SDI/HDMI input, mode detected automatically
  - `ndi:<source name>`
  - `srt://…` (listener or caller), `rtmp://…`, `rtsp://…`, `rtsps://…`, `udp://…` (MPEG-TS), `http(s)://…` (also HLS and DASH)
  - `whep:<URL>` — WebRTC (WHEP), e.g. from OBS
  - `sdp:<file>` — RTP described by an SDP file (also AES67 audio)
  - `screen:<n>` — screen capture
  - `file:<path>` (loops), `image:<path>`, `folder:<path>` (newest still image in a folder, switches when a newer one arrives)
  - Files, images, folders and SDP are picked with the system's own file dialog (Finder, Explorer).
- **Load and forecast**: engine and machine CPU, memory, the programme's actual frame rate and a warning when it falls behind — plus a forecast of how many more inputs and mics fit. The forecast learns what an input and a mic cost **on this machine** from its own measurements (and keeps that knowledge for the next start) instead of guessing.
- **Preview / programme** like a hardware mixer: Cut, Auto, T-bar and fade to black. The T-bar works like the lever of a hardware panel: it rests at one end, the transition runs to the other, and the next one runs back. Transitions: cut, mix, dip through black, push left/right, slide left/right, zoom — each with one of eleven easing curves (linear, sine, quad, cubic, quart, quint, expo, circ, back, elastic, bounce; in, out or in-out). The T-bar drives the transition by hand, without a curve. After a transition, programme and preview swap.
- **Two overlays** above the programme (downstream key or picture-in-picture), any input at any position and size, in and out with cut, fade, fly from four sides or zoom.
- **Audio**: one fader, mute and audio-follow-video per input plus master, with peak meters. With audio-follow-video the input is heard while it is on programme, and crossfades along with a transition.
- **Microphones**: any number of channels from audio interfaces (CoreAudio, WASAPI, PulseAudio/PipeWire), and so also Dante through Dante Virtual Soundcard or a Dante card — one channel of one device each, with fader, mute and a switch whether the mic goes into the programme audio.
- **Channel strip per microphone**: RNNoise speech denoising, high-pass, gate with hold, compressor with soft knee, makeup gain — written for speech, tested on its own.
- **Lip-sync delay** per input and per microphone (0–500 ms).
- **Video follows audio** for podcasts, talk rounds and panels: each microphone (or an input's own audio) belongs to a camera. The mixer cuts to whoever speaks, judged on pre-fader levels:
  - a speaker must be above the threshold and clearly louder than everyone else (bleed into the neighbour's mic does not count), and must hold for the attack time — a cough does not cut;
  - every shot stays for a minimum time;
  - cross-talk and longer silence go to the wide shot; with a maximum shot time set, a long monologue gets a short wide shot in between;
  - cut or the selected transition with its curve; a manual cut restarts the minimum shot time, video follows audio keeps running. It never starts by itself after a restart.
- **Graphics in EBU OGraf**: two graphics layers above everything except fade to black, with per-pixel transparency. Lower thirds, bugs and titles are OGraf graphics (any OGraf v1 graphic works, including lz-presenter's lyrics), played by the graphics renderer — a small companion app (`renderer/`) that renders them and sends the frames to the engine. Load, play, next step, update on air, custom actions, out. Bundled: lower third, corner bug, title card and live captions in the Lars Zumpe Medienproduktion design.
- **Multiview** 1280×720: preview and programme on top, all inputs below — more inputs, more columns. Shown in the UI, and available as an SDI output.
- **Outputs**, any number at the same time, added and removed while running:
  - `decklink:<n>` — programme to SDI with embedded audio, in the programme format
  - `decklink-mv:<n>` — multiview to SDI
  - `ndi:<name>`
  - `srt://host:port?mode=listener` — H.264/AAC in MPEG-TS
  - `rtmp://server/app/key`
  - `record:<file>.mp4` (H.264/AAC; the index is rewritten every five seconds, so a crash still leaves a playable file) or `record:<file>.mov` (ProRes 422 HQ, 24-bit PCM)
  - Hardware encoders when present: VideoToolbox (macOS), NVENC, Quick Sync; otherwise x264.
- **Live captions** from the intercom: its transcription sends every line as OSC (`/lzvm/caption`); the mixer loads the bundled captions graphic by itself and shows the text in the programme.
- **Audio output** of the programme to an audio interface or virtual device (`audio:<device>`) — into the intercom's Program channel, or for monitoring.
- **OSC** in and out: the same commands under `/lzvm/…`, tally and status as feedback to any number of targets — for TouchOSC, UnableSet (`oscOnEnter` per song), the intercom's keyword rules, lighting desks.
- **Control**: web UI at `http://127.0.0.1:4195`, WebSocket and HTTP API ([docs/api.md](docs/api.md)), short GET URLs for Companion (`/api/cut`, `/api/auto`, `/api/preview/3`, `/api/overlay/1/toggle`, `/api/vfa/toggle`, `/api/gfx/1/play`, `/api/gfx/1/next`, `/api/gfx/1/stop` …).
- Inputs, microphones, names, audio settings, transition, overlay and video-follows-audio settings are remembered between runs. Outputs and video follows audio are not started automatically.

## Formats

`--format` takes 720p50, 720p59.94, 1080p25, 1080p29.97, 1080p50, 1080p59.94, 2160p25 … (progressive). Default 1080p50. Inside, the mixer works in 8-bit 4:2:0.

## Install

1. **GStreamer 1.24 or newer** with the base, good, bad, ugly and libav plugins:
   - macOS: `brew install gstreamer`
   - Windows: the MSVC runtime installer from [gstreamer.freedesktop.org](https://gstreamer.freedesktop.org/download/) (complete installation)
   - Linux (Debian/Ubuntu): `sudo apt install gstreamer1.0-plugins-{base,good,bad,ugly} gstreamer1.0-libav`
2. For DeckLink: Blackmagic Desktop Video (driver). For NDI: the NDI runtime from [ndi.video](https://ndi.video/) and the GStreamer NDI plugin (part of the Homebrew package; on Linux/Windows from gst-plugins-rs).
3. For graphics: install **LZ Vision Mixer Graphics** (the renderer) from the same release page. Start it next to the engine — it connects by itself and shows its status in a small window and the tray — or let the engine start it: `--renderer "/Applications/LZ Vision Mixer Graphics.app"`. Own OGraf graphics go into `~/Documents/LZ Vision Mixer/Graphics`.
4. Download the engine for your system from [Releases](https://github.com/larszu/lz-vision-mixer/releases) and start it:
   ```bash
   ./lz-vision-mixer --open                 # 1080p50, UI on 127.0.0.1:4195
   ./lz-vision-mixer --format 1080p59.94 --listen 0.0.0.0:4195
   ```
   `--listen 0.0.0.0:4195` lets tablets and other computers on the network operate the mixer.

The UI shows which of DeckLink, NDI, SRT and the encoders this computer can use.

## Status

Tested on macOS (Apple M1 Pro) with test patterns, SRT out→in, NDI detection, recording to MP4 and ProRes, transitions, overlays, fade to black, a microphone of the built-in interface, video follows audio (speaker, silence → wide) and the bundled OGraf lower third through the renderer. **Not yet tested: DeckLink hardware (no card at hand), NDI with an installed runtime, multi-channel audio interfaces and Dante Virtual Soundcard, a real podcast with several speakers, Windows and Linux builds on real machines, long runs.** Audio and picture in the programme are within 2–5 ms of each other (measured on a ProRes/PCM recording) and within 36–53 ms in MP4 recordings, most of which is the AAC encoder start. The audio path suits the programme mix for streaming and recording, not PA or in-ear monitoring in the room. On the M1 Pro, three 1080p50 test inputs with multiview take about two CPU cores.

## SMPTE ST 2110

The mixer is built so that ST 2110 becomes one more source and output kind: the media graph is GStreamer, every input and output is its own pipeline behind the frame sync, and `st2110:` is reserved in the source and output specs. The plan is the [Intel Media Transport Library](https://github.com/OpenVisualCloud/Media-Transport-Library) (ST 2110-20/-22/-30/-40, ST 2022-7, PTP) through its GStreamer elements on Linux, followed by NMOS IS-04/05 via [nmos-cpp](https://github.com/sony/nmos-cpp). Needs a suitable network card and PTP; not wired up yet.

## Develop

```bash
cd ui && npm install && npm run build      # web UI → ui/dist (embedded into the engine)
cd ../engine && cargo run -- --open        # engine on 4195
cd ../ui && npm run dev                    # UI with hot reload on 4196, proxies to the engine
cd ../renderer && npm install && npm start # graphics renderer, connects to the engine on 4195
cd ui && npm run mock                      # engine mock on 4195 for UI work without GStreamer
PORT=4295 npm run mock && ENGINE=http://127.0.0.1:4295 npm run dev   # mock beside a running engine
cargo test --manifest-path engine/Cargo.toml
```

## Licence

MIT. Uses GStreamer (LGPL). DeckLink is a trademark of Blackmagic Design, NDI® a trademark of Vizrt NDI AB; not affiliated with either.
