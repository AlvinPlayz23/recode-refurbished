/**
 * Workspace picker. In the desktop app this navigates folders through Bun RPC.
 *
 * Polished surface: rounded glassy card with display-font header, breadcrumb
 * pill, search field, hoverable folder rows and a footer with key hints.
 * Visual language mirrors the CommandPalette so picker surfaces feel
 * consistent across the app.
 */

import { useEffect, useRef, useState } from 'react'
import * as ReactDOM from 'react-dom'
import {
  ArrowUp,
  Check,
  ChevronRight,
  Folder,
  FolderOpen,
  Loader2,
  Search,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { cn } from '../lib/cn'
import { pickerProjects, type PickerEntry } from '../mock-data'
import type { DesktopDirectoryListing } from '../desktop-rpc'

interface ProjectModalProps {
  open: boolean
  onClose: () => void
  onSelect: (entry: PickerEntry) => void
  onOpenDirectory?: (path?: string) => Promise<DesktopDirectoryListing>
  onSelectDirectory?: (path: string) => void
  showMockProjects?: boolean
  title?: string
  description?: string
  useLabel?: string
}

export function ProjectModal({
  open,
  onClose,
  onSelect,
  onOpenDirectory,
  onSelectDirectory,
  showMockProjects = true,
  title = 'Open workspace',
  description = 'Pick a folder for Recode to operate inside.',
  useLabel = 'Use folder',
}: ProjectModalProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [listing, setListing] = useState<DesktopDirectoryListing | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const desktopPicker = Boolean(onOpenDirectory)
  const normalizedQuery = query.trim().toLowerCase()
  const filteredEntries =
    listing?.entries.filter(
      (entry) =>
        normalizedQuery.length === 0 ||
        entry.name.toLowerCase().includes(normalizedQuery) ||
        entry.path.toLowerCase().includes(normalizedQuery),
    ) ?? []
  const filteredMockProjects = pickerProjects.filter(
    (entry) =>
      normalizedQuery.length === 0 ||
      entry.name.toLowerCase().includes(normalizedQuery) ||
      entry.path.toLowerCase().includes(normalizedQuery),
  )

  useEffect(() => {
    if (!open || !onOpenDirectory) return
    void openDirectory(undefined)
  }, [open, onOpenDirectory])

  useEffect(() => {
    if (open) {
      setQuery('')
      const handle = window.setTimeout(() => inputRef.current?.focus(), 50)
      return () => window.clearTimeout(handle)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  async function openDirectory(path: string | undefined) {
    if (!onOpenDirectory) return
    setLoading(true)
    setError(null)
    try {
      setListing(await onOpenDirectory(path))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoading(false)
    }
  }

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
            className="fixed inset-0 z-[100] bg-black/45 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
            className="fixed left-1/2 top-1/2 z-[110] w-full max-w-[520px] -translate-x-1/2 -translate-y-1/2 px-4"
          >
            <div
              className={cn(
                'relative flex flex-col overflow-hidden',
                'rounded-3xl border border-rc-border bg-rc-elevated/95 backdrop-blur-xl',
                'shadow-[0_30px_80px_-20px_rgba(0,0,0,0.45)]',
              )}
            >
              {/* Header */}
              <div className="flex items-start gap-3 px-5 pt-5 pb-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-rc-accent-soft">
                  <FolderOpen
                    className="h-[18px] w-[18px] text-rc-accent"
                    strokeWidth={1.8}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="display text-[16px] font-semibold leading-tight text-rc-text">
                    {title}
                  </h3>
                  <p className="mt-0.5 text-[12.5px] leading-snug text-rc-muted">
                    {description}
                  </p>
                </div>
              </div>

              {/* Breadcrumb / parent */}
              {desktopPicker && listing && (
                <div className="flex items-center gap-2 px-4 pb-3">
                  <button
                    type="button"
                    onClick={() => void openDirectory(listing.parentPath)}
                    disabled={!listing.parentPath || loading}
                    title="Parent folder"
                    className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl',
                      'border border-rc-border-soft bg-rc-card text-rc-muted',
                      'hover:border-rc-border hover:bg-rc-hover hover:text-rc-text',
                      'disabled:opacity-35 disabled:hover:border-rc-border-soft disabled:hover:bg-rc-card disabled:hover:text-rc-muted',
                      'transition-colors focus-ring',
                    )}
                  >
                    <ArrowUp className="h-4 w-4" strokeWidth={1.7} />
                  </button>
                  <div
                    className={cn(
                      'min-w-0 flex-1 truncate rounded-xl border border-rc-border-soft bg-rc-card px-3 py-1.5',
                      'mono text-[11.5px] text-rc-muted',
                    )}
                    title={listing.path}
                  >
                    {listing.path}
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelectDirectory?.(listing.path)}
                    disabled={loading}
                    className={cn(
                      'flex h-8 items-center gap-1.5 rounded-xl px-3',
                      'display bg-rc-text text-[12.5px] font-medium text-rc-bg',
                      'hover:opacity-85 disabled:opacity-50 transition-opacity focus-ring',
                    )}
                  >
                    <Check className="h-3.5 w-3.5" strokeWidth={2.2} />
                    {useLabel}
                  </button>
                </div>
              )}

              {/* Search */}
              {(desktopPicker || (!desktopPicker && showMockProjects)) && (
                <div className="px-4 pb-3">
                  <div
                    className={cn(
                      'flex h-10 items-center gap-2.5 rounded-2xl border border-rc-border-soft bg-rc-card px-3.5',
                      'focus-within:border-rc-accent/40 focus-within:bg-rc-elevated',
                      'focus-within:ring-2 focus-within:ring-rc-accent-soft',
                      'transition-[border,box-shadow,background]',
                    )}
                  >
                    <Search
                      className="h-4 w-4 shrink-0 text-rc-faint"
                      strokeWidth={1.8}
                    />
                    <input
                      ref={inputRef}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={
                        desktopPicker ? 'Search folders' : 'Search workspaces'
                      }
                      className={cn(
                        'min-w-0 flex-1 border-0 bg-transparent outline-none',
                        'text-[13px] text-rc-text placeholder-rc-faint',
                      )}
                    />
                    {query && (
                      <button
                        type="button"
                        onClick={() => setQuery('')}
                        className="rounded-md px-1.5 py-0.5 text-[11px] text-rc-muted hover:bg-rc-hover hover:text-rc-text transition-colors"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Body */}
              <div className="max-h-[360px] min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                {loading && (
                  <div className="flex items-center gap-2 px-3 py-3 text-[12.5px] text-rc-muted">
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.7} />
                    Loading folders
                  </div>
                )}
                {error && (
                  <div
                    className={cn(
                      'mx-2 my-2 rounded-2xl border border-destructive/30 bg-destructive/8 px-3 py-2',
                      'text-[12px] text-[color:var(--destructive)]',
                    )}
                  >
                    {error}
                  </div>
                )}
                {desktopPicker && !loading && listing?.entries.length === 0 && (
                  <EmptyState message="No folders here." />
                )}
                {desktopPicker &&
                  !loading &&
                  listing &&
                  listing.entries.length > 0 &&
                  filteredEntries.length === 0 && (
                    <EmptyState message={`No folders match "${query}".`} />
                  )}
                {desktopPicker &&
                  filteredEntries.map((entry) => (
                    <FolderRow
                      key={entry.path}
                      name={entry.name}
                      path={entry.path}
                      onClick={() => void openDirectory(entry.path)}
                    />
                  ))}
                {!desktopPicker &&
                  showMockProjects &&
                  filteredMockProjects.length === 0 && (
                    <EmptyState message={`No workspaces match "${query}".`} />
                  )}
                {!desktopPicker &&
                  showMockProjects &&
                  filteredMockProjects.map((entry) => (
                    <FolderRow
                      key={entry.id}
                      name={entry.name}
                      path={entry.path}
                      onClick={() => onSelect(entry)}
                    />
                  ))}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between border-t border-rc-border-soft bg-rc-sidebar/60 px-4 py-2.5">
                <span className="display text-[11.5px] text-rc-muted">
                  {desktopPicker
                    ? 'Navigate folders to find your project'
                    : 'Recent workspaces'}
                </span>
                <div className="flex items-center gap-2">
                  <kbd className="mono inline-flex h-6 items-center gap-1 rounded-md border border-rc-border-soft bg-rc-card px-2 text-[10px] font-medium text-rc-faint">
                    ESC
                  </kbd>
                  <button
                    type="button"
                    onClick={onClose}
                    className={cn(
                      'display rounded-lg px-2.5 py-1 text-[12px] text-rc-muted',
                      'hover:bg-rc-hover hover:text-rc-text transition-colors focus-ring',
                    )}
                  >
                    Cancel
                  </button>
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

function FolderRow({
  name,
  path,
  onClick,
}: {
  name: string
  path: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex w-full items-center gap-3 rounded-2xl px-3 py-2.5',
        'text-left transition-colors hover:bg-rc-hover focus-ring',
      )}
    >
      <div
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-xl',
          'border border-rc-border-soft bg-rc-card text-rc-muted',
          'transition-colors group-hover:border-rc-border group-hover:bg-rc-accent-soft group-hover:text-rc-accent',
        )}
      >
        <Folder className="h-4 w-4" strokeWidth={1.6} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="display truncate text-[13.5px] font-medium text-rc-text">
          {name}
        </div>
        <div className="mono truncate text-[11px] text-rc-faint">{path}</div>
      </div>
      <ChevronRight
        className={cn(
          'h-4 w-4 shrink-0 -translate-x-1 text-rc-faint opacity-60',
          'transition-all group-hover:translate-x-0 group-hover:text-rc-muted group-hover:opacity-100',
        )}
        strokeWidth={1.6}
      />
    </button>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-rc-hover">
        <Folder className="h-5 w-5 text-rc-faint" strokeWidth={1.6} />
      </div>
      <p className="display text-[12.5px] text-rc-muted">{message}</p>
    </div>
  )
}
