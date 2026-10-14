import { useEffect, useState } from 'react'
import { send, useLevels } from '../client'
import { formatDb } from '../helpers'
import { t } from '../i18n'
import type { AudioDevice, Mic, State } from '../types'
import { Fader, Icon, Meter, Panel, StatusSign } from './ui'

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

function MicRow({ m, devices, peak }: { m: Mic; devices: AudioDevice[]; peak: number | undefined }) {
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
    if (n === m.name || !m.device) return
    send({ cmd: 'setMic', mic: m.mic, device: m.device, channel: m.channel, name: n })
  }

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
            disabled={!used}
            title={used ? undefined : t('Choose a device first')}
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
  const devices = state.audioDevices
  return (
    <Panel
      title={t('Microphones')}
      className="mics"
      actions={
        <button type="button" className="btn btn-sm btn-ghost push-end" onClick={() => send({ cmd: 'refreshDevices' })} title={t('Look for audio devices again')}>
          <Icon name="refresh" size={16} />
          {t('Refresh devices')}
        </button>
      }
    >
      {devices.length === 0 && <p className="hint">{t('No audio devices found. Connect an interface and refresh.')}</p>}
      <div className="mic-list">
        {state.mics.map((m) => (
          <MicRow key={m.mic} m={m} devices={devices} peak={levels?.mics[m.mic]} />
        ))}
      </div>
    </Panel>
  )
}
