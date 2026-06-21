/**
 * Keyboard shortcut cheatsheet overlay. Opened by pressing `?` (when not
 * typing) or via in-app menus. Mirrors the visual style of the command palette
 * for consistency: blurred backdrop + centered rounded surface.
 */

import { useEffect, type ReactNode } from 'react'
import ReactDOM from 'react-dom'
import { Keyboard, X } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'

interface ShortcutsOverlayProps {
  open: boolean
  onClose: () => void
}

interface ShortcutRow {
  keys: string[]
  description: string
}

interface ShortcutSection {
  title: string
  items: ShortcutRow[]
}

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform)
const META = isMac ? '⌘' : 'Ctrl'

const SECTIONS: ShortcutSection[] = [
  {
    title: 'General',
    items: [
      { keys: [META, 'K'], description: 'Open command palette' },
      { keys: [META, 'N'], description: 'Start a new chat' },
      { keys: [META, 'L'], description: 'Focus the composer' },
      { keys: ['?'], description: 'Show this shortcuts overlay' },
      { keys: ['Esc'], description: 'Dismiss any open overlay' },
    ],
  },
  {
    title: 'Composer',
    items: [
      { keys: ['↵'], description: 'Send message' },
      { keys: ['⇧', '↵'], description: 'Insert newline' },
    ],
  },
  {
    title: 'Transcript',
    items: [
      { keys: ['Hover'], description: 'Reveal copy button on a message' },
      { keys: ['Scroll'], description: 'Auto-stick to bottom while near it' },
    ],
  },
]

export function ShortcutsOverlay({ open, onClose }: ShortcutsOverlayProps) {
  useEffect(() => {
    if (!open) return
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (typeof document === 'undefined') return null

  return ReactDOM.createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="shortcuts-backdrop"
            className="fixed inset-0 z-[140] bg-black/45 backdrop-blur-sm"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
          />
          <motion.div
            key="shortcuts-card"
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
            className="fixed left-1/2 top-1/2 z-[150] w-full max-w-[560px] -translate-x-1/2 -translate-y-1/2 px-4"
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -6 }}
            transition={{ duration: 0.16, ease: [0.4, 0, 0.2, 1] }}
          >
            <div className="overflow-hidden rounded-2xl border border-rc-border bg-rc-elevated/95 backdrop-blur-xl shadow-2xl">
              {/* Header */}
              <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-rc-border-soft">
                <div className="flex items-center gap-2.5">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-rc-border-soft bg-rc-card text-rc-muted">
                    <Keyboard className="h-3.5 w-3.5" strokeWidth={1.7} />
                  </span>
                  <div className="leading-tight">
                    <div className="text-[13px] font-medium text-rc-text">
                      Keyboard shortcuts
                    </div>
                    <div className="text-[11.5px] text-rc-faint">
                      Press <Kbd>?</Kbd> any time to open this list
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="tool-action-button"
                  onClick={onClose}
                  aria-label="Close shortcuts"
                  title="Close (Esc)"
                  autoFocus
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.8} />
                </button>
              </div>

              {/* Body */}
              <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
                <div className="space-y-5">
                  {SECTIONS.map((section) => (
                    <div key={section.title}>
                      <div className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-rc-faint mb-2">
                        {section.title}
                      </div>
                      <ul className="divide-y divide-rc-border-soft/60">
                        {section.items.map((row) => (
                          <li
                            key={`${section.title}-${row.description}`}
                            className="flex items-center justify-between gap-4 py-2"
                          >
                            <span className="text-[12.5px] text-rc-text">
                              {row.description}
                            </span>
                            <span className="flex shrink-0 items-center gap-1">
                              {row.keys.map((k, idx) => (
                                <Kbd key={`${row.description}-${k}-${idx}`}>{k}</Kbd>
                              ))}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  )
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.5rem] h-[1.4rem] px-1.5 rounded-md border border-rc-border-soft bg-rc-card text-[11px] text-rc-text font-medium mono shadow-[0_1px_0_0_rgba(0,0,0,0.04)]">
      {children}
    </kbd>
  )
}
