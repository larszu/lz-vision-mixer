import { useRef, useState } from 'react'
import { send, useLevels } from '../client'
import { faderToGain, formatDb, gainToFader, meterFill, meterZone } from '../helpers'
import { t } from '../i18n'
import type { State } from '../types'
import { Panel } from './ui'

function Meter({ peaks }: { peaks: [number, number] | undefined }) {
  const [l, r] = peaks ?? [-90, -90]
  return (
    <div className="meter" aria-hidden="true">
      {[l, r].map((db, i) => (
        <div key={i} className="meter-ch">
          <div className={`meter-fill zone-${meterZone(db)}`} style={{ height: `${meterFill(db) * 100}%` }} />
        </div>
      ))}
    </div>
  )
}

/** Fader in dB travel; volume sends are coalesced per frame while dragging. */
function Fader({ volume, label, onVolume }: { volume: number; label: string; onVolume: (v: number) => void }) {
  const [drag, setDrag] = useState<number | null>(null)
  const pending = useRef<number | null>(null)
  const pos = drag ?? gainToFader(volume)
  const queue = (g: number) => {
    if (pending.current == null)
      requestAnimationFrame(() => {
        if (pending.current != null) onVolume(pending.current)
        pending.current = null
      })
    pending.current = g
  }
  return (
    <input
      type="range"
      className="fader"
      min={0}
      max={1000}
      value={Math.round(pos * 1000)}
      aria-label={label}
      aria-valuetext={`${formatDb(faderToGain(pos))} dB`}
      title={t('Double-click for 0 dB')}
      onChange={(e) => {
        const p = Number(e.target.value) / 1000
        setDrag(p)
        queue(faderToGain(p))
      }}
      onPointerUp={() => setDrag(null)}
      onBlur={() => setDrag(null)}
      onDoubleClick={() => {
        setDrag(null)
        onVolume(1)
      }}
    />
  )
}

function Strip({
  name,
  volume,
  muted,
  afv,
  peaks,
  onVolume,
  onMute,
  onAfv,
  master,
}: {
  name: string
  volume: number
  muted: boolean
  afv?: boolean
  peaks: [number, number] | undefined
  onVolume: (v: number) => void
  onMute: () => void
  onAfv?: () => void
  master?: boolean
}) {
  return (
    <div className={`strip ${master ? 'strip-master' : ''} ${muted ? 'muted' : ''}`}>
      <span className="strip-name" title={name}>
        {name}
      </span>
      <div className="strip-body">
        <Meter peaks={peaks} />
        <Fader volume={volume} label={`${t('Volume')} ${name}`} onVolume={onVolume} />
      </div>
      <span className="strip-db">{formatDb(volume)} dB</span>
      <button type="button" className={`btn btn-sm ${muted ? 'selected warn' : ''}`} aria-pressed={muted} onClick={onMute}>
        {t('Mute')}
      </button>
      {onAfv && (
        <button
          type="button"
          className={`btn btn-sm ${afv ? 'selected' : ''}`}
          aria-pressed={!!afv}
          onClick={onAfv}
          title={t('Audio follows video')}
        >
          {t('AFV')}
        </button>
      )}
    </div>
  )
}

export function AudioPanel({ state }: { state: State }) {
  const levels = useLevels()
  return (
    <Panel title={t('Audio')} className="audio">
      <div className="strips">
        {state.slots.map((s) => (
          <Strip
            key={s.slot}
            name={`${s.slot} ${s.name}`}
            volume={s.audio.volume}
            muted={s.audio.muted}
            afv={s.audio.afv}
            peaks={levels?.slots[s.slot]}
            onVolume={(volume) => send({ cmd: 'audio', slot: s.slot, volume })}
            onMute={() => send({ cmd: 'audio', slot: s.slot, muted: !s.audio.muted })}
            onAfv={() => send({ cmd: 'audio', slot: s.slot, afv: !s.audio.afv })}
          />
        ))}
        <Strip
          master
          name={t('Master')}
          volume={state.master.volume}
          muted={state.master.muted}
          peaks={levels?.master}
          onVolume={(volume) => send({ cmd: 'master', volume })}
          onMute={() => send({ cmd: 'master', muted: !state.master.muted })}
        />
      </div>
    </Panel>
  )
}
