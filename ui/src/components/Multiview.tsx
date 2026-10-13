import { useState } from 'react'
import { send, useConn } from '../client'
import { MV_PREVIEW, MV_PROGRAM, mvSlotBox, tallyOf, type Box } from '../helpers'
import { t } from '../i18n'
import type { State } from '../types'

const pct = (b: Box) => ({ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` })

export function Multiview({ state }: { state: State | null }) {
  const conn = useConn()
  const [broken, setBroken] = useState(false)
  // A new <img> per connection, so the MJPEG stream restarts after the engine comes back.
  const [generation, setGeneration] = useState(0)
  const [lastStatus, setLastStatus] = useState(conn.status)
  if (conn.status !== lastStatus) {
    setLastStatus(conn.status)
    if (conn.status === 'open') {
      setGeneration((g) => g + 1)
      setBroken(false)
    }
  }

  const name = (slot: number | null) => (slot == null ? '' : (state?.slots.find((s) => s.slot === slot)?.name ?? `${slot}`))
  const mixing = !!state && (state.inTransition || state.tbar > 0)

  return (
    <div className={`multiview ${conn.status === 'open' ? '' : 'stale'}`}>
      {!broken && (
        <img
          key={generation}
          src={`mjpeg/multiview?c=${generation}`}
          alt={t('Multiview')}
          onError={() => setBroken(true)}
          onLoad={() => setBroken(false)}
        />
      )}
      {(broken || conn.status !== 'open') && <div className="mv-nosignal">{t('No multiview signal')}</div>}
      <div className="mv-overlay">
        <div className={`mv-box mv-big ${mixing ? 'tally-program' : 'tally-preview'}`} style={pct(MV_PREVIEW)}>
          <span className="mv-label">
            {t('Preview')} {state?.preview != null && <b>{name(state.preview)}</b>}
          </span>
        </div>
        <div className="mv-box mv-big tally-program" style={pct(MV_PROGRAM)}>
          <span className="mv-label">
            {t('Program')} {state?.program != null && <b>{name(state.program)}</b>}
            {state?.ftb && <b className="mv-ftb">{t('FTB')}</b>}
          </span>
        </div>
        {Array.from({ length: 8 }, (_, i) => i + 1).map((slot) => {
          const tally = state ? tallyOf(slot, state) : null
          return (
            <button
              key={slot}
              type="button"
              className={`mv-box mv-tile ${tally ? `tally-${tally}` : ''}`}
              style={pct(mvSlotBox(slot))}
              onClick={() => send({ cmd: 'preview', slot })}
              onDoubleClick={() => send({ cmd: 'program', slot })}
              title={t('Click for preview, double-click to cut to program')}
            >
              <span className="mv-label">
                <span className="mv-num">{slot}</span> {name(slot)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
