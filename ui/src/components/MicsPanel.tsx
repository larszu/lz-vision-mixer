import { useEffect, useState } from 'react'
import { send, useLevels, usePerf } from '../client'
import { formatDb } from '../helpers'
import { t } from '../i18n'
import { clampDelay, DELAY_MAX_MS, stripSummary } from '../strip'
import type { AudioDevice, Mic, State } from '../types'
import { StripEditor } from './StripEditor'
import { roomShort } from '../perf'
import { ConfirmDialog, Fader, Icon, Meter, NumberField, Panel, StatusSign } from './ui'

export function micStatus(m: Mic) {
  switch (m.status) {
    case 'running':
      return { tone: 'ok' as const, label: t('Running') }
    case 'starting':
      return { tone: 'warn' as const, label: t('Starting') }
    case 'error':
      return { tone: 'error' as const, label: t('Error') }
    default:
      return { tone: 'idle' as const, label: t('Unused') }
  }
}

/** Name of a mic for lists: its own name, else "Mic N". */
export const micLabel = (m: Mic | undefined, n: number) => (m?.name ? `${t('Mic')} ${n} · ${m.name}` : `${t('Mic')} ${n}`)

function MicRow({ m, devices, peak, open, onToggle, onRemove }: { m: Mic; devices: AudioDevice[]; peak: number | undefined; open: boolean; onToggle: () => void; onRemove: () => void }) {
  const [name, setName] = useState(m.name)
  useEffect(() => setName(m.name), [m.name])
  const dev = devices.find((d) => d.id === m.device)
  const missing = m.device != null && !dev
  const st = micStatus(m)
  const used = m.device != null

  const pick = (deviceId: string, channel: number) => {
    if (!deviceId) return send({ cmd: 'clearMic', mic: m.mic })
    send({ cmd: 'setMic', mic: m.mic, device: deviceId, channel, ...(name.trim() ? { name: name.trim() } : {}) })
  }
  const commitName = () => {
    const n = name.trim()
    if (n === m.name) return
    send({ cmd: 'renameMic', mic: m.mic, name: n })
  }
  const summary = stripSummary(m.strip)
  const panelId = `strip-${m.mic}`

  return (
    <div className={`mic-row ${m.muted ? 'muted' : ''} ${used ? '' : 'unused'}`}>
      <span className="mic-num" aria-hidden="true">
        {m.mic}
      </span>
      <div className="mic-top">
        <label className="field-stack mic-name">
          <span className="sr-only">
            {t('Mic')} {m.mic} {t('Name')}
          </span>
          <input
            value={name}
            placeholder={`${t('Mic')} ${m.mic}`}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            autoComplete="off"
          />
        </label>
        <label className="field-stack mic-device">
          <span className="sr-only">
            {t('Mic')} {m.mic} {t('Device')}
          </span>
          <select value={m.device ?? ''} onChange={(e) => pick(e.target.value, 0)}>
            <option value="">{t('No device')}</option>
            {missing && <option value={m.device!}>{`${m.device} (${t('missing')})`}</option>}
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field-stack mic-channel">
          <span className="sr-only">
            {t('Mic')} {m.mic} {t('Channel')}
          </span>
          <select value={m.channel} disabled={!dev} onChange={(e) => pick(m.device!, Number(e.target.value))} title={t('Channel')}>
            {Array.from({ length: dev?.channels ?? Math.max(1, m.channel + 1) }, (_, i) => (
              <option key={i} value={i}>
                {t('Ch')} {i + 1}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-sm btn-icon btn-ghost mic-remove" onClick={onRemove} aria-label={`${t('Remove mic')} ${m.mic}`} title={t('Remove mic')}>
          <Icon name="trash" size={16} />
        </button>
      </div>
      <div className="mic-bottom">
        <div className="mic-level">
          <Meter peaks={[used ? (peak ?? -90) : -90]} horizontal />
          <Fader horizontal volume={m.volume} label={`${t('Volume')} ${t('Mic')} ${m.mic}`} onVolume={(volume) => send({ cmd: 'micAudio', mic: m.mic, volume })} />
        </div>
        <span className="strip-db">{formatDb(m.volume)} dB</span>
        <button
          type="button"
          className={`btn btn-sm btn-mute ${m.muted ? 'active' : ''}`}
          aria-pressed={m.muted}
          onClick={() => send({ cmd: 'micAudio', mic: m.mic, muted: !m.muted })}
        >
          {t('Mute')}
        </button>
        <button
          type="button"
          className={`btn btn-sm ${m.inProgram ? 'selected' : ''}`}
          aria-pressed={m.inProgram}
          title={t('Mixed into the programme audio. Off: only steers video follows audio.')}
          onClick={() => send({ cmd: 'micAudio', mic: m.mic, inProgram: !m.inProgram })}
        >
          {t('PGM')}
        </button>
      </div>
      <div className="mic-strip-bar">
        <button type="button" className={`btn btn-sm btn-ghost strip-toggle ${open ? 'open' : ''}`} aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
          <Icon name="chevron" size={16} />
          {t('Channel strip')}
        </button>
        <span className="strip-summary" title={summary.map((x) => t(x)).join(' · ')}>
          {summary.length ? summary.map((x) => t(x)).join(' · ') : t('No processing')}
        </span>
        <NumberField
          className="field-delay"
          label={t('Delay')}
          title={t('Lip-sync delay, 0 to 500 ms')}
          unit="ms"
          min={0}
          max={DELAY_MAX_MS}
          step={1}
          value={m.delayMs}
          onCommit={(v) => send({ cmd: 'micAudio', mic: m.mic, delayMs: clampDelay(v) })}
        />
      </div>
      {open && <StripEditor id={panelId} m={m} />}
      {(m.status !== 'running' || m.error) && used && (
        <div className="mic-status">
          <StatusSign tone={st.tone} label={st.label} />
          {m.error && <span className="mic-error">{m.error}</span>}
        </div>
      )}
    </div>
  )
}

export function MicsPanel({ state }: { state: State }) {
  const levels = useLevels()
  const perf = usePerf()
  const [open, setOpen] = useState<number | null>(null)
  const [removing, setRemoving] = useState<Mic | null>(null)
  const devices = state.audioDevices
  const room = perf ? roomShort(perf.forecast.moreMics) : null
  const rules = removing ? state.vfa.rules.filter((r) => r.source === `mic:${removing.mic}`).length : 0
  return (
    <Panel
      title={t('Microphones')}
      className="mics"
      actions={
        <>
          <button type="button" className="btn btn-sm btn-soft" onClick={() => send({ cmd: 'addMic' })}>
            <Icon name="plus" size={16} />
            {t('Add mic')}
          </button>
          {room && <span className={`meta room ${perf?.forecast.moreMics === 0 ? 'room-full' : ''}`}>{room}</span>}
          <button type="button" className="btn btn-sm btn-ghost push-end" onClick={() => send({ cmd: 'refreshDevices' })} title={t('Look for audio devices again')}>
            <Icon name="refresh" size={16} />
            {t('Refresh devices')}
          </button>
        </>
      }
    >
      {devices.length === 0 && <p className="hint">{t('No audio devices found. Connect an interface and refresh.')}</p>}
      {state.mics.length === 0 && <p className="empty">{t('No mics yet. Add one per microphone channel.')}</p>}
      <div className="mic-list">
        {state.mics.map((m) => (
          <MicRow
            key={m.mic}
            m={m}
            devices={devices}
            peak={levels?.mics[m.mic]}
            open={open === m.mic}
            onToggle={() => setOpen(open === m.mic ? null : m.mic)}
            onRemove={() => setRemoving(m)}
          />
        ))}
      </div>
      {removing && (
        <ConfirmDialog
          title={`${t('Remove mic')} ${removing.mic}?`}
          confirmLabel={t('Remove mic')}
          onConfirm={() => send({ cmd: 'removeMic', mic: removing.mic })}
          onClose={() => setRemoving(null)}
        >
          <p>
            <b>{micLabel(removing, removing.mic)}</b>
          </p>
          <p className="hint">
            {t('The number stays free; VFA rules that listen to this mic are cleared.')}
            {rules > 0 && ` (${rules} ${rules === 1 ? t('rule') : t('rules')})`}
          </p>
        </ConfirmDialog>
      )}
    </Panel>
  )
}
