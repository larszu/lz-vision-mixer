import { describe, expect, it } from 'vitest'
import { needMet } from '../src/helpers'
import { SOURCE_GROUPS, SOURCE_KINDS, buildSpec, initialValues, parseSpec, type SourceKindId } from '../src/sources'

describe('source specs', () => {
  it('builds every kind of docs/api.md', () => {
    expect(buildSpec('device', { device: 'avf:0' })).toBe('device:avf:0')
    expect(buildSpec('device', { device: 'avf:0', audio: 'coreaudio:usb' })).toBe('device:avf:0#audio=coreaudio:usb')
    expect(buildSpec('screen', { display: '1' })).toBe('screen:1')
    expect(buildSpec('srtListener', { port: '9001' })).toBe('srt://0.0.0.0:9001?mode=listener')
    expect(buildSpec('srtCaller', { host: '10.0.0.5', port: '9000' })).toBe('srt://10.0.0.5:9000?mode=caller')
    expect(buildSpec('srtCaller', { host: 'fd00::5', port: '9000' })).toBe('srt://[fd00::5]:9000?mode=caller')
    expect(buildSpec('rtmp', { url: 'rtmp://live.local/app/cam' })).toBe('rtmp://live.local/app/cam')
    expect(buildSpec('rtsp', { url: '192.168.1.50:554/stream1' })).toBe('rtsp://192.168.1.50:554/stream1')
    expect(buildSpec('rtsp', { url: 'rtsps://cam/x' })).toBe('rtsps://cam/x')
    expect(buildSpec('udp', { host: '239.1.1.1', port: '5000' })).toBe('udp://239.1.1.1:5000')
    expect(buildSpec('udp', { host: '', port: '5000' })).toBe('udp://0.0.0.0:5000')
    expect(buildSpec('http', { url: 'https://cdn/x/index.m3u8' })).toBe('https://cdn/x/index.m3u8')
    expect(buildSpec('whep', { url: 'https://server/whep/1' })).toBe('whep:https://server/whep/1')
    expect(buildSpec('file', { path: '/clips/a.mp4' })).toBe('file:/clips/a.mp4')
    expect(buildSpec('image', { path: '/stills/logo.png' })).toBe('image:/stills/logo.png')
    expect(buildSpec('folder', { path: '/incoming' })).toBe('folder:/incoming')
    expect(buildSpec('sdp', { path: '/s/aes67.sdp' })).toBe('sdp:/s/aes67.sdp')
    expect(buildSpec('st2110', { path: '/s/2110.sdp' })).toBe('st2110:/s/2110.sdp')
    expect(buildSpec('decklink', { n: '2' })).toBe('decklink:2')
    expect(buildSpec('ndi', { name: 'STUDIO (OBS)' })).toBe('ndi:STUDIO (OBS)')
    expect(buildSpec('test', { pattern: 'ball' })).toBe('test:ball')
  })
  it('returns null while fields are missing or wrong', () => {
    expect(buildSpec('device', {})).toBeNull()
    expect(buildSpec('srtListener', { port: '70000' })).toBeNull()
    expect(buildSpec('srtListener', { port: 'abc' })).toBeNull()
    expect(buildSpec('srtCaller', { host: '', port: '9000' })).toBeNull()
    expect(buildSpec('rtmp', { url: 'https://wrong' })).toBeNull()
    expect(buildSpec('file', { path: '  ' })).toBeNull()
    expect(buildSpec('test', { pattern: 'nope' })).toBeNull()
  })
  it('reads specs back into kind and fields', () => {
    expect(parseSpec('device:avf:0#audio=coreaudio:usb')).toEqual({ kind: 'device', values: { device: 'avf:0', audio: 'coreaudio:usb' } })
    expect(parseSpec('device:v4l2:/dev/video0')).toEqual({ kind: 'device', values: { device: 'v4l2:/dev/video0', audio: '' } })
    expect(parseSpec('srt://0.0.0.0:9000?mode=listener')).toEqual({ kind: 'srtListener', values: { port: '9000' } })
    expect(parseSpec('srt://cam.local:9000')).toEqual({ kind: 'srtCaller', values: { host: 'cam.local', port: '9000' } })
    expect(parseSpec('udp://@239.0.0.1:1234')).toEqual({ kind: 'udp', values: { host: '239.0.0.1', port: '1234' } })
    expect(parseSpec('http://x/live.mpd')?.kind).toBe('http')
    expect(parseSpec('rtmps://x/app')?.kind).toBe('rtmp')
    expect(parseSpec('whep:https://s/w')).toEqual({ kind: 'whep', values: { url: 'https://s/w' } })
    expect(parseSpec('test:smpte')).toEqual({ kind: 'test', values: { pattern: 'smpte' } })
    expect(parseSpec('test:unknown')).toBeNull()
    expect(parseSpec('weird:thing')).toBeNull()
    expect(parseSpec(null)).toBeNull()
  })
  it('round-trips every kind', () => {
    const samples: Record<SourceKindId, string> = {
      device: 'device:avf:1#audio=coreaudio:x',
      screen: 'screen:0',
      srtListener: 'srt://0.0.0.0:9000?mode=listener',
      srtCaller: 'srt://10.0.0.5:9000?mode=caller',
      rtmp: 'rtmp://a/b/c',
      rtsp: 'rtsp://cam/1',
      udp: 'udp://0.0.0.0:5000',
      http: 'https://cdn/x.m3u8',
      whep: 'whep:https://s/whep',
      st2110: 'st2110:/a.sdp',
      file: 'file:/a b/c.mp4',
      image: 'image:/c.png',
      folder: 'folder:/in',
      sdp: 'sdp:/x.sdp',
      decklink: 'decklink:3',
      ndi: 'ndi:PC (Cam 1)',
      test: 'test:snow',
    }
    for (const k of SOURCE_KINDS) {
      const p = parseSpec(samples[k.id])
      expect(p?.kind, k.id).toBe(k.id)
      expect(buildSpec(p!.kind, p!.values), k.id).toBe(samples[k.id])
    }
  })
  it('groups all kinds and knows which need a capability', () => {
    for (const k of SOURCE_KINDS) expect(SOURCE_GROUPS.some((g) => g.id === k.group)).toBe(true)
    const caps = { decklink: false, ndi: false, srt: true, st2110: false, encoders: [] }
    const off = SOURCE_KINDS.filter((k) => !needMet(k.need, caps)).map((k) => k.id)
    expect(off).toEqual(['st2110', 'decklink', 'ndi'])
    expect(SOURCE_KINDS.filter((k) => k.pick).map((k) => [k.id, k.pick])).toEqual([
      ['st2110', 'sdp'],
      ['file', 'video'],
      ['image', 'image'],
      ['folder', 'folder'],
      ['sdp', 'sdp'],
    ])
  })
  it('starts a camera on the first device', () => {
    expect(initialValues('device', 'avf:0')).toEqual({ device: 'avf:0' })
    expect(buildSpec('test', initialValues('test'))).toBe('test:smpte')
    expect(buildSpec('srtListener', initialValues('srtListener'))).toBe('srt://0.0.0.0:9000?mode=listener')
  })
})
