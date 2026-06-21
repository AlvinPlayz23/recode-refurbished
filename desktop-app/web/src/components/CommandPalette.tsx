/**
 * Polished command palette built on top of `cmdk` + motion.
 *
 * Public API is unchanged (open / items / onClose) so the rest of the app
 * still drives it through the global Ctrl+K shortcut. Internally we now use
 * cmdk's fuzzy filter, with motion-based entry/exit and a glassy popover.
 */

import { Command } from 'cmdk'
import { ArrowRight, Search } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import * as ReactDOM from 'react-dom'
import { useEffect, useMemo, useRef, useState } from 'react'

export interface CommandPaletteItem {
  id: string
  title: string
  detail?: string
  section: string
  keywords?: string
  run: () => void
}

interface CommandPaletteProps {
  open: boolean
  items: CommandPaletteItem[]
  onClose: () => void
}

interface CommandPaletteGroup {
  title: string
  items: CommandPaletteItem[]
}

function groupItems(items: CommandPaletteItem[]): CommandPaletteGroup[] {
  const map = new Map<string, CommandPaletteItem[]>()
  for (const item of items) {
    const key = item.section || 'Other'
    const arr = map.get(key) ?? []
    arr.push(item)
    map.set(key, arr)
  }
  return Array.from(map.entries()).map(([title, groupItems]) => ({
    title,
    items: groupItems,
  }))
}

export function CommandPalette({
  open,
  items,
  onClose,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const groups = useMemo(() => groupItems(items), [items])

  useEffect(() => {
    if (!open) {
      setQuery('')
      return
    }
    const handle = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(handle)
  }, [open])

  if (typeof document === 'undefined') return null

  return ReactDOM.createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[140] bg-black/45 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -4 }}
            transition={{
              duration: 0.2,
              ease: [0.32, 0.72, 0, 1],
            }}
            className="fixed left-1/2 top-1/2 z-[150] w-full max-w-[640px] -translate-x-1/2 -translate-y-1/2 px-4"
          >
            <Command
              label="Command Menu"
              shouldFilter
              className="overflow-hidden rounded-2xl border border-rc-border bg-rc-elevated/95 backdrop-blur-xl shadow-2xl"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  onClose()
                }
              }}
            >
              <div className="flex items-center gap-3 border-b border-rc-border-soft px-4 py-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rc-accent-soft">
                  <Search className="h-4 w-4 text-rc-accent" strokeWidth={2} />
                </div>
                <Command.Input
                  ref={inputRef}
                  value={query}
                  onValueChange={setQuery}
                  placeholder="Search commands, threads, workspaces"
                  className="flex-1 bg-transparent text-[14px] font-normal text-rc-text outline-none placeholder:text-rc-faint"
                  autoFocus
                />
                {query && (
                  <motion.button
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    onClick={() => setQuery('')}
                    className="rounded-md px-2 py-1 text-[11px] text-rc-muted hover:bg-rc-hover hover:text-rc-text transition-colors"
                  >
                    Clear
                  </motion.button>
                )}
                <kbd className="mono hidden sm:inline-flex h-6 items-center gap-1 rounded-md border border-rc-border-soft bg-rc-card px-2 text-[10px] font-medium text-rc-faint">
                  ESC
                </kbd>
              </div>

              <Command.List className="max-h-[420px] overflow-y-auto overscroll-contain p-2">
                <Command.Empty className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-rc-hover">
                    <Search
                      className="h-5 w-5 text-rc-faint"
                      strokeWidth={1.8}
                    />
                  </div>
                  <p className="text-[13px] text-rc-muted">
                    No commands found
                  </p>
                  <p className="text-[11px] text-rc-faint">
                    Try searching for something else
                  </p>
                </Command.Empty>

                {groups.map((group) => (
                  <Command.Group
                    key={group.title}
                    heading={group.title}
                    className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-rc-faint"
                  >
                    {group.items.map((item) => (
                      <Command.Item
                        key={item.id}
                        value={`${group.title} ${item.title} ${item.detail ?? ''} ${item.keywords ?? ''}`}
                        onSelect={() => {
                          item.run()
                          onClose()
                        }}
                        className="group/item relative flex cursor-pointer select-none items-center gap-3 rounded-xl px-3 py-2 text-[13px] outline-none transition-colors aria-[selected='true']:bg-rc-hover-strong aria-[selected='true']:text-rc-text data-[disabled='true']:pointer-events-none data-[disabled='true']:opacity-50"
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rc-hover text-rc-muted group-aria-[selected='true']/item:bg-rc-accent-soft group-aria-[selected='true']/item:text-rc-accent transition-colors">
                          <CommandIcon section={group.title} />
                        </div>
                        <div className="flex flex-1 min-w-0 flex-col gap-0.5">
                          <span className="truncate font-medium text-rc-text">
                            {item.title}
                          </span>
                          {item.detail && (
                            <span className="truncate text-[11.5px] text-rc-muted">
                              {item.detail}
                            </span>
                          )}
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 -translate-x-2 opacity-0 transition-all text-rc-muted group-aria-[selected='true']/item:opacity-100 group-aria-[selected='true']/item:translate-x-0" />
                      </Command.Item>
                    ))}
                  </Command.Group>
                ))}
              </Command.List>

              <div className="flex items-center justify-between border-t border-rc-border-soft bg-rc-sidebar/60 px-4 py-2.5">
                <div className="flex items-center gap-4 text-[11px] text-rc-muted">
                  <span className="flex items-center gap-1.5">
                    <kbd className="mono rounded border border-rc-border-soft bg-rc-card px-1.5 py-0.5 text-[10px]">
                      ↑↓
                    </kbd>
                    Navigate
                  </span>
                  <span className="flex items-center gap-1.5">
                    <kbd className="mono rounded border border-rc-border-soft bg-rc-card px-1.5 py-0.5 text-[10px]">
                      ↵
                    </kbd>
                    Select
                  </span>
                </div>
                <span className="text-[11px] text-rc-faint">Recode</span>
              </div>
            </Command>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/**
 * Tiny visual chip per section. Falls back to a dot.
 */
function CommandIcon({ section }: { section: string }) {
  const initial = (section || '?').trim().charAt(0).toUpperCase()
  return <span className="mono text-[12px] font-semibold">{initial}</span>
}
