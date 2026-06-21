/**
 * Slim header above the transcript. Shows the project / thread breadcrumb
 * with a subtle status pill when the agent is running, and a refined sidebar
 * toggle / overflow menu using coss design tokens.
 */

import { MoreHorizontal, PanelLeftOpen } from 'lucide-react'
import type { Project, Thread } from '../types'
import { cn } from '../lib/cn'

interface ChatHeaderProps {
  project: Project | null
  thread: Thread | null
  /**
   * If true, treat this as a brand-new / unused thread and hide the
   * breadcrumb. Once the thread has activity it becomes "real" and we show it.
   */
  fresh?: boolean
  /** When true, show a button on the left to re-open the sidebar. */
  sidebarHidden?: boolean
  onShowSidebar?: () => void
}

const STATUS_LABEL: Record<NonNullable<Thread['status']>, string> = {
  running: 'Running',
  requires_action: 'Awaiting',
  error: 'Error',
  idle: 'Idle',
}

const STATUS_TONE: Record<NonNullable<Thread['status']>, string> = {
  running:
    'border-success/30 bg-success/10 text-[color:var(--success)] before:bg-[color:var(--success)] before:animate-pulse',
  requires_action:
    'border-warning/40 bg-warning/10 text-[color:var(--warning)] before:bg-[color:var(--warning)]',
  error:
    'border-destructive/40 bg-destructive/10 text-[color:var(--destructive)] before:bg-[color:var(--destructive)]',
  idle: 'border-rc-border-soft bg-rc-hover text-rc-faint before:bg-rc-faint',
}

export function ChatHeader({
  project,
  thread,
  fresh,
  sidebarHidden,
  onShowSidebar,
}: ChatHeaderProps) {
  const showBreadcrumb = !fresh && project && thread
  const status =
    thread?.status && thread.status !== 'idle' ? thread.status : null

  return (
    <header
      className={cn(
        'h-12 flex items-center justify-between gap-2 px-3 border-b border-rc-border-soft',
        'bg-rc-bg/80 backdrop-blur-sm supports-[backdrop-filter]:bg-rc-bg/70',
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5 text-[12.5px]">
        {sidebarHidden && (
          <button
            type="button"
            onClick={onShowSidebar}
            title="Show sidebar"
            className={cn(
              'mr-1 flex h-8 w-8 items-center justify-center rounded-full',
              'text-rc-muted hover:bg-rc-hover hover:text-rc-text',
              'transition-colors focus-ring',
            )}
          >
            <PanelLeftOpen className="h-[15px] w-[15px]" strokeWidth={1.5} />
          </button>
        )}
        {showBreadcrumb && (
          <>
            <span className="max-w-[200px] truncate text-rc-muted">
              {project.name}
            </span>
            <span className="mx-0.5 text-rc-faint">/</span>
            <span className="display truncate font-medium text-rc-text">
              {thread.title}
            </span>
            {status && (
              <span
                className={cn(
                  'ml-2 inline-flex items-center gap-1.5 rounded-full border px-2 py-[1px]',
                  'text-[10.5px] font-medium uppercase tracking-wider',
                  'before:h-1.5 before:w-1.5 before:rounded-full before:content-[""]',
                  STATUS_TONE[status],
                )}
              >
                {STATUS_LABEL[status]}
              </span>
            )}
          </>
        )}
      </div>
      <button
        type="button"
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-full',
          'text-rc-faint hover:bg-rc-hover hover:text-rc-text',
          'transition-colors focus-ring',
        )}
        title="More"
      >
        <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} />
      </button>
    </header>
  )
}
