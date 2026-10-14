import { useEffect, useMemo, useState } from 'react'
import { send } from '../client'
import { gfxHasNext } from '../helpers'
import { t } from '../i18n'
import { defaultsFor, initialData, sameData, schemaToFields } from '../schemaForm'
import type { GraphicAction, GraphicInfo, GraphicsLayer, State } from '../types'
import { SchemaFields } from './SchemaForm'
import { Icon, Panel, StatusSign } from './ui'

type Data = Record<string, unknown>

export function layerStatus(l: GraphicsLayer) {
  switch (l.status) {
    case 'playing':
      return { tone: 'live' as const, label: t('On air') }
    case 'ready':
      return { tone: 'ok' as const, label: t('Loaded') }
    case 'loading':
      return { tone: 'warn' as const, label: t('Loading') }
    case 'stopped':
      return { tone: 'idle' as const, label: t('Out') }
    case 'error':
      return { tone: 'error' as const, label: t('Error') }
    default:
      return { tone: 'idle' as const, label: t('Empty') }
  }
}

function CustomAction({ a, layer, disabled }: { a: GraphicAction; layer: number; disabled: boolean }) {
  const fields = useMemo(() => schemaToFields(a.schema), [a.schema])
  const [payload, setPayload] = useState<Data>(() => defaultsFor(fields))
  return (
    <div className="custom-action">
      <button
        type="button"
        className="btn btn-sm"
        disabled={disabled}
        title={a.description}
        onClick={() => send({ cmd: 'gfxCustom', layer, id: a.id, ...(fields.length ? { payload } : {}) })}
      >
        {a.name}
      </button>
      {fields.length > 0 && <SchemaFields fields={fields} data={payload} onChange={setPayload} idPrefix={`ca-${layer}-${a.id}`} />}
    </div>
  )
}

function LayerCard({ layer, library, connected }: { layer: GraphicsLayer; library: GraphicInfo[]; connected: boolean }) {
  const [graphicId, setGraphicId] = useState<string>(layer.graphicId ?? library[0]?.id ?? '')
  const info = library.find((g) => g.id === graphicId)
  const fields = useMemo(() => schemaToFields(info?.schema), [info])
  const [data, setData] = useState<Data>(() => initialData(info?.schema, layer.graphicId === graphicId ? layer.data : null))
  const [dirty, setDirty] = useState(false)

  // Follow changes made elsewhere (Companion, another operator) unless the form has unsent edits.
  useEffect(() => {
    if (dirty || !layer.graphicId) return
    const g = library.find((x) => x.id === layer.graphicId)
    setGraphicId(layer.graphicId)
    setData(initialData(g?.schema, layer.data))
  }, [layer.graphicId, JSON.stringify(layer.data)])
  // First library arriving after the panel mounted.
  useEffect(() => {
    if (!graphicId && library[0]) {
      setGraphicId(library[0].id)
      setData(initialData(library[0].schema, null))
    }
  }, [library, graphicId])

  const loadedHere = layer.graphicId === graphicId && layer.status !== 'empty'
  const live = layer.status === 'playing'
  const canPlay = loadedHere && (layer.status === 'ready' || layer.status === 'stopped')
  const canUpdate = loadedHere && layer.status !== 'loading' && layer.status !== 'error'
  const changed = loadedHere && !sameData(data, layer.data)
  const st = layerStatus(layer)
  const loadedInfo = library.find((g) => g.id === layer.graphicId)
  const steps = loadedInfo?.stepCount ?? 1

  const edit = (d: Data) => {
    setData(d)
    setDirty(true)
  }
  const pick = (id: string) => {
    const g = library.find((x) => x.id === id)
    setGraphicId(id)
    setData(initialData(g?.schema, layer.graphicId === id ? layer.data : null))
    setDirty(layer.graphicId !== id)
  }

  return (
    <article className={`gfx-layer ${live ? 'live' : ''}`} aria-label={`${t('Layer')} ${layer.layer}`}>
      <header className="gfx-head">
        <h3>
          {t('Layer')} {layer.layer}
        </h3>
        <StatusSign tone={st.tone} label={st.label} />
        {live && steps !== 1 && (
          <span className="meta tabular">
            {t('Step')} {layer.step + 1}
            {steps > 1 ? ` / ${steps}` : ''}
          </span>
        )}
        {layer.graphicId && layer.graphicId !== graphicId && (
          <span className="meta push-end" title={t('Loaded on this layer')}>
            {loadedInfo?.name ?? layer.graphicId}
          </span>
        )}
      </header>
      {layer.error && <p className="hint hint-error">{layer.error}</p>}

      <label className="field-stack">
        <span>{t('Graphic')}</span>
        <select value={graphicId} onChange={(e) => pick(e.target.value)} disabled={library.length === 0}>
          {library.length === 0 && <option value="">{t('No graphics')}</option>}
          {library.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      {info?.description && <p className="meta gfx-desc">{info.description}</p>}

      {fields.length > 0 && <SchemaFields fields={fields} data={data} onChange={edit} idPrefix={`gfx-${layer.layer}`} />}

      <div className="gfx-actions">
        <button
          type="button"
          className="btn"
          disabled={!connected || !graphicId}
          onClick={() => {
            send({ cmd: 'gfxLoad', layer: layer.layer, graphicId, data })
            setDirty(false)
          }}
          title={live ? t('Loading replaces the graphic that is on air') : undefined}
        >
          {t('Load')}
        </button>
        <button
          type="button"
          className={`btn btn-gfx-in ${live ? 'on-air' : ''}`}
          disabled={!canPlay}
          aria-pressed={live}
          onClick={() => send({ cmd: 'gfxPlay', layer: layer.layer })}
          title={layer.layer === 1 ? t('Take in (G)') : undefined}
        >
          {live ? t('On air') : t('In')}
        </button>
        {steps !== 1 && (
          <button
            type="button"
            className="btn"
            disabled={!gfxHasNext(layer, loadedInfo)}
            onClick={() => send({ cmd: 'gfxPlay', layer: layer.layer, delta: 1 })}
            title={layer.layer === 1 ? t('Next step (G)') : undefined}
          >
            {t('Next')}
          </button>
        )}
        <button
          type="button"
          className="btn"
          disabled={!live}
          onClick={() => send({ cmd: 'gfxStop', layer: layer.layer })}
          title={layer.layer === 1 ? t('Take out (H)') : undefined}
        >
          {t('Out')}
        </button>
        <button
          type="button"
          className={`btn ${changed ? 'btn-soft' : ''}`}
          disabled={!canUpdate}
          onClick={() => {
            send({ cmd: 'gfxUpdate', layer: layer.layer, data })
            setDirty(false)
          }}
          title={t('Send the form to the loaded graphic')}
        >
          {t('Update')}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-danger push-end"
          disabled={layer.status === 'empty'}
          onClick={() => {
            send({ cmd: 'gfxClear', layer: layer.layer })
            setDirty(false)
          }}
        >
          {t('Clear')}
        </button>
      </div>
      {changed && <p className="hint">{t('The form differs from what the layer shows. Update sends it.')}</p>}

      {loadedHere && (loadedInfo?.customActions.length ?? 0) > 0 && (
        <div className="custom-actions" role="group" aria-label={t('Actions of this graphic')}>
          {loadedInfo!.customActions.map((a) => (
            <CustomAction key={a.id} a={a} layer={layer.layer} disabled={!canUpdate} />
          ))}
        </div>
      )}
    </article>
  )
}

export function GraphicsPanel({ state }: { state: State }) {
  const g = state.graphics
  return (
    <Panel
      title={t('Graphics')}
      className="graphics"
      actions={
        <>
          <StatusSign
            tone={g.rendererConnected ? 'ok' : 'error'}
            label={g.rendererConnected ? t('Renderer connected') : t('Renderer not connected')}
          />
          <button
            type="button"
            className="btn btn-sm btn-ghost push-end"
            disabled={!g.rendererConnected}
            onClick={() => send({ cmd: 'gfxRescan' })}
            title={t('Read the graphics folders again')}
          >
            <Icon name="refresh" size={16} />
            {t('Rescan')}
          </button>
        </>
      }
    >
      {!g.rendererConnected && <p className="hint hint-warn">{t('Start the graphics renderer to load and play graphics. Layers keep their last picture.')}</p>}
      {g.rendererConnected && g.library.length === 0 && (
        <p className="hint">{t('No graphics found. Put OGraf graphics into Documents/LZ Vision Mixer/Graphics and rescan.')}</p>
      )}
      <div className="gfx-layers">
        {g.layers.map((l) => (
          <LayerCard key={l.layer} layer={l} library={g.library} connected={g.rendererConnected} />
        ))}
      </div>
    </Panel>
  )
}
