import { useEffect, useRef, useState, type ReactNode } from 'react'
import { pickPath, send } from '../client'
import { needMet, specNeed } from '../helpers'
import { needLabel, t } from '../i18n'
import { SOURCE_GROUPS, SOURCE_KINDS, TEST_PATTERNS, buildSpec, initialValues, kindById, parseSpec, type SourceGroupId, type SourceKindId, type SourceValues } from '../sources'
import type { PickKind, Slot, State } from '../types'
import { RemoveInputDialog } from './Inputs'
import { Icon } from './ui'

const URL_PLACEHOLDER: Partial<Record<SourceKindId, string>> = {
  rtmp: 'rtmp://server/app/stream',
  rtsp: 'rtsp://192.168.1.50:554/stream1',
  http: 'https://example.com/live/index.m3u8',
  whep: 'https://server/whep/endpoint',
}

const PATH_PLACEHOLDER: Partial<Record<PickKind, string>> = {
  video: '/Users/me/Movies/clip.mp4',
  image: '/Users/me/Pictures/still.png',
  folder: '/Users/me/Pictures/Incoming',
  sdp: '/Users/me/stream.sdp',
}

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`field-stack ${wide ? 'src-field-wide' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  )
}

/** Browse button: the engine opens Finder/Explorer on its own machine and hands back the path. */
function BrowseButton({ kind, onPath }: { kind: PickKind; onPath: (p: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  return (
    <div className="browse">
      <button
        type="button"
        className="btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setNote(null)
          const r = await pickPath(kind)
          setBusy(false)
          if ('path' in r) onPath(r.path)
          else if ('cancelled' in r) setNote(t('Nothing chosen.'))
        }}
      >
        <Icon name="folder" size={16} />
        {busy ? t('Waiting for the dialog…') : t('Browse…')}
      </button>
      <span className="meta">{note ?? t('Opens on the computer running the engine.')}</span>
    </div>
  )
}

function KindForm({ kind, values, set, state }: { kind: SourceKindId; values: SourceValues; set: (v: SourceValues) => void; state: State }) {
  const v = (k: keyof SourceValues) => values[k] ?? ''
  const on = (k: keyof SourceValues) => (e: { target: { value: string } }) => set({ ...values, [k]: e.target.value })
  const info = kindById(kind)
  switch (kind) {
    case 'device': {
      const devices = state.videoDevices
      const missingVideo = !!v('device') && !devices.some((d) => d.id === v('device'))
      const missingAudio = !!v('audio') && !state.audioDevices.some((d) => d.id === v('audio'))
      return (
        <>
          <div className="src-row">
            <Field label={t('Camera or capture card')} wide>
              <select value={v('device')} onChange={on('device')}>
                {!v('device') && <option value="">{devices.length ? t('Choose…') : t('None found')}</option>}
                {missingVideo && <option value={v('device')}>{`${v('device')} (${t('missing')})`}</option>}
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
            <button type="button" className="btn btn-ghost src-refresh" onClick={() => send({ cmd: 'refreshDevices' })} title={t('Look for cameras and audio devices again')}>
              <Icon name="refresh" size={16} />
              {t('Refresh devices')}
            </button>
          </div>
          <Field label={t('Sound')} wide>
            <select value={v('audio')} onChange={on('audio')}>
              <option value="">{t('From the device, if it has any')}</option>
              {missingAudio && <option value={v('audio')}>{`${v('audio')} (${t('missing')})`}</option>}
              {state.audioDevices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          {devices.length === 0 && <p className="hint hint-warn">{t('No cameras or capture cards found. Connect one and refresh.')}</p>}
        </>
      )
    }
    case 'screen': {
      const cur = Number(v('display') || 0)
      const opts = Array.from({ length: Math.max(4, cur + 1) }, (_, i) => i)
      return (
        <Field label={t('Display')}>
          <select value={cur} onChange={on('display')}>
            {opts.map((i) => (
              <option key={i} value={i}>
                {t('Display')} {i + 1}
                {i === 0 ? ` (${t('main')})` : ''}
              </option>
            ))}
          </select>
        </Field>
      )
    }
    case 'srtListener':
      return (
        <Field label={t('Port')}>
          <input inputMode="numeric" value={v('port')} onChange={on('port')} placeholder="9000" autoComplete="off" />
        </Field>
      )
    case 'srtCaller':
    case 'udp':
      return (
        <div className="src-row src-host-port">
          <Field label={kind === 'udp' ? t('Address (multicast or 0.0.0.0)') : t('Host')} wide>
            <input value={v('host')} onChange={on('host')} placeholder={kind === 'udp' ? '0.0.0.0' : '192.168.1.20'} autoComplete="off" spellCheck={false} />
          </Field>
          <Field label={t('Port')}>
            <input inputMode="numeric" value={v('port')} onChange={on('port')} placeholder={kind === 'udp' ? '5000' : '9000'} autoComplete="off" />
          </Field>
        </div>
      )
    case 'rtmp':
    case 'rtsp':
    case 'http':
    case 'whep':
      return (
        <Field label={t('URL')} wide>
          <input value={v('url')} onChange={on('url')} placeholder={URL_PLACEHOLDER[kind]} autoComplete="off" spellCheck={false} />
        </Field>
      )
    case 'file':
    case 'image':
    case 'folder':
    case 'sdp':
    case 'st2110':
      return (
        <>
          <Field label={kind === 'folder' ? t('Folder') : t('File')} wide>
            <input value={v('path')} onChange={on('path')} placeholder={PATH_PLACEHOLDER[info.pick!]} autoComplete="off" spellCheck={false} />
          </Field>
          <BrowseButton kind={info.pick!} onPath={(path) => set({ ...values, path })} />
        </>
      )
    case 'decklink': {
      const cur = Number(v('n') || 0)
      return (
        <Field label={t('Input')}>
          <select value={cur} onChange={on('n')}>
            {Array.from({ length: Math.max(8, cur + 1) }, (_, i) => (
              <option key={i} value={i}>
                DeckLink {i + 1}
              </option>
            ))}
          </select>
        </Field>
      )
    }
    case 'ndi':
      return (
        <Field label={t('Source name')} wide>
          <input value={v('name')} onChange={on('name')} placeholder="STUDIO-PC (OBS)" autoComplete="off" spellCheck={false} />
        </Field>
      )
    case 'test':
      return (
        <div className="presets" role="radiogroup" aria-label={t('Test pattern')}>
          {TEST_PATTERNS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={v('pattern') === p.id}
              className={`chip ${v('pattern') === p.id ? 'selected' : ''}`}
              onClick={() => set({ ...values, pattern: p.id })}
            >
              {t(p.label)}
            </button>
          ))}
        </div>
      )
  }
}

/**
 * Source of an input, or a new input (slot null). Built from a kind and a few
 * fields; the spec field below shows the result and takes free text as well.
 */
export function SourceDialog({ slot, state, onClose }: { slot: Slot | null; state: State; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const caps = state.capabilities
  const firstDevice = state.videoDevices[0]?.id
  const parsed = parseSpec(slot?.spec)
  const [name, setName] = useState(slot?.name ?? '')
  const [kind, setKind] = useState<SourceKindId | null>(parsed?.kind ?? null)
  const [group, setGroup] = useState<SourceGroupId | null>(parsed ? kindById(parsed.kind).group : null)
  const [values, setValues] = useState<SourceValues>(parsed?.values ?? {})
  const [spec, setSpec] = useState(slot?.spec ?? '')
  const [removing, setRemoving] = useState(false)

  useEffect(() => {
    ref.current?.showModal()
  }, [])

  const chooseKind = (k: SourceKindId) => {
    setGroup(kindById(k).group)
    if (k === kind) return
    const v = initialValues(k, firstDevice)
    setKind(k)
    setValues(v)
    setSpec(buildSpec(k, v) ?? '')
  }
  const setFormValues = (v: SourceValues) => {
    setValues(v)
    if (kind) setSpec(buildSpec(kind, v) ?? '')
  }
  const typeSpec = (text: string) => {
    setSpec(text)
    const p = parseSpec(text)
    setKind(p?.kind ?? null)
    if (p) {
      setValues(p.values)
      setGroup(kindById(p.kind).group)
    }
  }

  const built = kind ? buildSpec(kind, values) : null
  const incomplete = kind != null && built == null
  const need = specNeed(spec)
  const missing = need && !needMet(need, caps)
  const s = spec.trim()
  const n = name.trim()

  const apply = () => {
    if (incomplete) return
    if (!slot) send({ cmd: 'addInput', ...(s ? { spec: s } : {}), ...(n ? { name: n } : {}) })
    else if (s && s !== slot.spec) send({ cmd: 'setInput', slot: slot.slot, spec: s, ...(n ? { name: n } : {}) })
    else if (n !== slot.name) send({ cmd: 'renameInput', slot: slot.slot, name: n })
    ref.current?.close()
  }

  const kindMissing = (k: SourceKindId) => !needMet(kindById(k).need, caps)
  const info = kind ? kindById(kind) : null
  const groupKinds = SOURCE_KINDS.filter((k) => k.group === group)
  const chooseGroup = (g: SourceGroupId) => {
    setGroup(g)
    if (kind && kindById(kind).group === g) return
    const first = SOURCE_KINDS.find((k) => k.group === g && !kindMissing(k.id))
    if (first) chooseKind(first.id)
  }

  return (
    <dialog ref={ref} className="dialog dialog-wide source-dialog" onClose={onClose} aria-labelledby="src-title">
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault()
          apply()
        }}
      >
        <header className="panel-head">
          <h2 className="dialog-title" id="src-title">
            {slot ? `${t('Input')} ${slot.slot}` : t('Add input')}
          </h2>
        </header>
        <label className="field field-wide">
          <span>{t('Name')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('From the source if empty')} autoComplete="off" />
        </label>

        <div className="src-groups" role="group" aria-label={t('Source type')}>
          {SOURCE_GROUPS.map((g) => {
            const kinds = SOURCE_KINDS.filter((k) => k.group === g.id)
            const off = kinds.every((k) => kindMissing(k.id))
            const current = group === g.id
            return (
              <button
                key={g.id}
                type="button"
                className={`chip ${current ? 'selected' : ''}`}
                aria-pressed={current}
                disabled={off && !current}
                title={off ? needLabel(kinds[0].need) : undefined}
                onClick={() => chooseGroup(g.id)}
              >
                {t(g.label)}
                {off && <span className="chip-note">· {t('not available')}</span>}
              </button>
            )
          })}
        </div>

        <div className="src-body">
          {groupKinds.length > 1 && (
            <div className="presets src-kinds" role="radiogroup" aria-label={t(SOURCE_GROUPS.find((g) => g.id === group)!.label)}>
              {groupKinds.map((k) => {
                const off = kindMissing(k.id)
                return (
                  <button
                    key={k.id}
                    type="button"
                    role="radio"
                    aria-checked={kind === k.id}
                    className={`chip ${kind === k.id ? 'selected' : ''}`}
                    disabled={off && kind !== k.id}
                    title={off ? needLabel(k.need) : t(k.hint)}
                    onClick={() => chooseKind(k.id)}
                  >
                    {t(k.label)}
                    {off && <span className="chip-note">· {t('not available')}</span>}
                  </button>
                )
              })}
            </div>
          )}
          <div className="src-form">
            {info ? (
              <>
                <h3 className="src-form-title">{t(info.label)}</h3>
                <p className="hint hint-top">{t(info.hint)}</p>
                {kindMissing(info.id) && <p className="hint hint-warn">{needLabel(info.need)}</p>}
                <KindForm kind={info.id} values={values} set={setFormValues} state={state} />
              </>
            ) : s ? (
              <p className="hint">{t('Custom spec: the engine reads it as typed below.')}</p>
            ) : (
              <p className="hint">{slot ? t('Choose a source type.') : t('Choose a source type, or add the input empty and choose later.')}</p>
            )}
          </div>
        </div>

        <label className="field field-wide src-spec">
          <span>{t('Source spec')}</span>
          <input
            className="mono"
            value={spec}
            onChange={(e) => typeSpec(e.target.value)}
            placeholder={incomplete ? t('Fill in the fields above') : 'test:smpte'}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        {missing && <p className="hint hint-warn">{needLabel(need)}</p>}

        <footer className="dialog-actions">
          {slot && (
            <button type="button" className="btn btn-ghost btn-danger" onClick={() => setRemoving(true)}>
              <Icon name="trash" size={16} />
              {t('Remove input')}
            </button>
          )}
          {slot?.spec && (
            <button
              type="button"
              className="btn btn-ghost"
              title={t('Keeps the input and its number, without a source')}
              onClick={() => {
                send({ cmd: 'clearInput', slot: slot.slot })
                ref.current?.close()
              }}
            >
              {t('Clear input')}
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={() => ref.current?.close()}>
            {t('Cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={incomplete} title={incomplete ? t('Fill in the fields above') : undefined}>
            {slot ? t('Apply') : s || kind ? t('Add input') : t('Add empty input')}
          </button>
        </footer>
      </form>
      {removing && slot && (
        <RemoveInputDialog
          slot={slot}
          state={state}
          onClose={() => setRemoving(false)}
          onRemoved={() => ref.current?.close()}
        />
      )}
    </dialog>
  )
}
