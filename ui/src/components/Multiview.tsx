import { useState } from 'react'
import { send, useConn } from '../client'
import { areaBox, tallyOf, type Box } from '../helpers'
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
  const mv = state?.multiview
  // Small tiles (many inputs) get a smaller label so names stay readable.
  const dense = !!mv && mv.tiles.length > 0 && mv.tiles[0].w / mv.width < 0.2

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
      {state && mv && (
        <div className={`mv-overlay ${dense ? 'mv-dense' : ''}`}>
          <div className={`mv-box mv-big ${mixing ? 'tally-program' : 'tally-preview'}`} style={pct(areaBox(mv.preview, mv))}>
            <span className="mv-label">
              {t('Preview')} {state.preview != null && <b>{name(state.preview)}</b>}
            </span>
          </div>
          <div className="mv-box mv-big tally-program" style={pct(areaBox(mv.program, mv))}>
            <span className="mv-label">
              {t('Program')} {state.program != null && <b>{name(state.program)}</b>}
              {state.ftb && <b className="mv-ftb">{t('FTB')}</b>}
            </span>
          </div>
          {mv.tiles.map((tile) => {
            const tally = tallyOf(tile.slot, state)
            return (
              <button
                key={tile.slot}
                type="button"
                className={`mv-box mv-tile ${tally ? `tally-${tally}` : ''}`}
                style={pct(areaBox(tile, mv))}
                onClick={() => send({ cmd: 'preview', slot: tile.slot })}
                onDoubleClick={() => send({ cmd: 'program', slot: tile.slot })}
                title={`${tile.slot} ${name(tile.slot)}: ${t('Click for preview, double-click to cut to program')}`}
              >
                <span className="mv-label">
                  <span className="mv-num">{tile.slot}</span> {name(tile.slot)}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
