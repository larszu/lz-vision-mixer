import { useEffect, useRef } from 'react'
import { SHORTCUTS } from '../helpers'
import { t } from '../i18n'

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  return (
    <dialog ref={ref} className="dialog dialog-narrow" onClose={onClose} aria-labelledby="keys-title" onClick={(e) => e.target === ref.current && ref.current.close()}>
      <h2 className="dialog-title" id="keys-title">
        {t('Keyboard shortcuts')}
      </h2>
      <dl className="shortcuts">
        {SHORTCUTS.map((s) => (
          <div key={s.keys}>
            <dt>
              <kbd>{s.keys === 'Space' ? t('Space') : s.keys === 'Enter' ? t('Enter') : s.keys}</kbd>
            </dt>
            <dd>{t(s.action)}</dd>
          </div>
        ))}
      </dl>
      <p className="meta">{t('Shortcuts are off while you type in a field.')}</p>
      <footer className="dialog-actions">
        <span className="spacer" />
        <button type="button" className="btn" onClick={() => ref.current?.close()} autoFocus>
          {t('Close')}
        </button>
      </footer>
    </dialog>
  )
}
