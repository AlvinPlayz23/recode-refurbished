/**
 * Document-style transcript: user messages in a soft gray bubble (right-aligned),
 * assistant messages as plain prose (left-aligned, no bubble).
 */

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ArrowDown,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Copy,
  FileText,
  HelpCircle,
  Minimize2,
  ListChecks,
  Loader2,
  Terminal,
  XCircle,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ChatMessage, Thread } from '../types'
import { TextShimmer } from './TextShimmer'
import { ThinkingRow } from './ThinkingRow'

/**
 * If the user is within this many pixels of the bottom of the transcript, we
 * consider them "pinned" and will keep auto-scrolling as new content streams
 * in. If they've scrolled further up, we leave them where they are.
 */
const STICK_TO_BOTTOM_THRESHOLD = 96

interface TranscriptProps {
  thread: Thread | null
  messages: ChatMessage[]
  isGenerating?: boolean
}

/**
 * Initial guess for a row's pixel height before it gets measured. The exact
 * value doesn't matter for correctness — TanStack swaps it for the real
 * measured height as soon as each row mounts via `measureElement`.
 */
const ESTIMATED_MESSAGE_HEIGHT = 120

/**
 * Returns a single number that grows when an in-flight message's *visible*
 * content grows. We watch both `body` (assistant streaming text) and
 * `toolContent` (tool output streaming back) so the stick-to-bottom effect
 * fires for either kind of update.
 */
function getMessageStreamingSize(message: ChatMessage | undefined): number {
  if (!message) return 0
  return message.body.length + (message.toolContent?.length ?? 0)
}

export function Transcript({ thread, messages, isGenerating = false }: TranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showJumpToBottom, setShowJumpToBottom] = useState(false)

  // Track "is the user pinned to the bottom" so we only auto-scroll when they
  // haven't intentionally scrolled up to read history.
  const stickToBottom = useRef(true)
  const previousMessageCount = useRef(messages.length)
  const previousThreadId = useRef(thread?.id ?? null)
  const previousLastMessageId = useRef(messages[messages.length - 1]?.id ?? null)
  // Tracks the *visible* content size (body + tool output) of whichever
  // message was the last one in the array on the previous render. Used to
  // detect token-by-token streaming (id unchanged, but content grew) so we
  // can keep the viewport pinned.
  const previousLastMessageSize = useRef(getMessageStreamingSize(messages[messages.length - 1]))

  // Variable-height virtualization. Every message row mounts with a stable
  // `data-index` and the virtualizer's `measureElement` ref, so the real
  // pixel height is recorded after layout and the total scroll size always
  // matches what the user sees — no more fixed 96px-per-row guesses.
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_MESSAGE_HEIGHT,
    overscan: 8,
    getItemKey: (index) => messages[index]?.id ?? index,
  })

  const totalSize = virtualizer.getTotalSize()
  const virtualItems = virtualizer.getVirtualItems()

  // When switching threads, jump to the bottom instantly without animating —
  // smooth-scroll on a thread change feels janky.
  useLayoutEffect(() => {
    if (previousThreadId.current === (thread?.id ?? null)) return
    previousThreadId.current = thread?.id ?? null
    stickToBottom.current = true
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [thread?.id])

  // After messages change, smoothly scroll if the user is pinned to the bottom
  // OR if a brand-new message just arrived (typically the user's own send).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const lastMessage = messages[messages.length - 1]
    const justAddedMessage = messages.length > previousMessageCount.current
    const lastIdChanged = (lastMessage?.id ?? null) !== previousLastMessageId.current
    const currentSize = getMessageStreamingSize(lastMessage)
    const lastBodyGrew = currentSize > previousLastMessageSize.current
    const lastIsUser = lastMessage?.role === 'user'

    previousMessageCount.current = messages.length
    previousLastMessageId.current = lastMessage?.id ?? null
    previousLastMessageSize.current = currentSize

    // A user just hit send — always glide to the bottom, even if they were
    // scrolled up reading earlier history.
    if (justAddedMessage && lastIsUser) {
      stickToBottom.current = true
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      return
    }

    if (!stickToBottom.current) return
    if (!justAddedMessage && !lastIdChanged && !lastBodyGrew) return

    el.scrollTo({
      top: el.scrollHeight,
      behavior: 'smooth',
    })
  }, [messages])

  // The virtualizer re-measures rows as they mount and as their content grows
  // (streaming tokens, expanded tool output, image loads, etc.). Whenever the
  // resulting total content size changes and the user is pinned, glide the
  // viewport back to the bottom so streaming output stays visible without the
  // abrupt token-by-token snapping.
  useLayoutEffect(() => {
    if (!stickToBottom.current) return
    const el = scrollRef.current
    if (!el) return
    const frame = window.requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [totalSize])

  if (!thread) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-10 text-center">
        <div className="w-12 h-12 rounded-xl border border-rc-border bg-rc-card flex items-center justify-center mb-4">
          <Terminal className="w-5 h-5 text-rc-muted" strokeWidth={1.5} />
        </div>
        <h3 className="text-[14px] font-medium text-rc-text mb-1">
          No thread selected
        </h3>
        <p className="text-[12.5px] text-rc-muted max-w-xs leading-relaxed">
          Pick a thread on the left, or start a new one with the composer below.
        </p>
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[12.5px] text-rc-muted">
        Empty thread — say something to get started.
      </div>
    )
  }

  function jumpToBottom() {
    const el = scrollRef.current
    if (!el) return
    stickToBottom.current = true
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto"
        onScroll={(event) => {
          const target = event.currentTarget
          const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight
          stickToBottom.current = distanceFromBottom <= STICK_TO_BOTTOM_THRESHOLD
          // The jump-to-bottom pill should appear once the user has scrolled
          // up enough that they’d miss new messages — a bit further than the
          // "stick" threshold so it doesn’t flicker on tiny scrolls.
          setShowJumpToBottom(distanceFromBottom > STICK_TO_BOTTOM_THRESHOLD * 3)
        }}
      >
        <div className="max-w-[760px] mx-auto px-8 py-8">
          <div
            style={{
              height: `${totalSize}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualItems.map((virtualRow) => {
              const msg = messages[virtualRow.index]
              if (!msg) return null
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div className={getTranscriptSpacing(msg, messages[virtualRow.index - 1])}>
                    <TranscriptMessage message={msg} isGenerating={isGenerating} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      {/* Floating jump-to-bottom pill: appears when the user has scrolled up
          while new content is arriving, anchored just above the composer. */}
      <button
        type="button"
        onClick={jumpToBottom}
        aria-label="Scroll to latest"
        className={
          'jump-to-bottom-pill ' + (showJumpToBottom ? 'is-visible' : 'is-hidden')
        }
        tabIndex={showJumpToBottom ? 0 : -1}
      >
        <ArrowDown className="h-3.5 w-3.5" strokeWidth={1.9} />
        <span>Jump to latest</span>
      </button>
    </div>
  )
}

function TranscriptMessage({
  message,
  isGenerating,
}: {
  message: ChatMessage
  isGenerating: boolean
}) {
  if (message.role === 'user') {
    // The copy button is absolutely positioned just below the bubble so its
    // hover-only appearance doesn't permanently push surrounding messages
    // apart. The wrapper uses pb-7 only on hover to ensure the button has
    // breathing room while it's actually visible.
    return (
      <div className="group relative flex justify-end">
        <div className="bg-rc-bubble text-rc-text rounded-2xl px-4 py-2.5 text-[13.5px] max-w-[85%] leading-relaxed whitespace-pre-wrap">
          {message.body}
        </div>
        {!isGenerating && (
          <div className="absolute right-0 top-full mt-1 z-10 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150 pointer-events-none group-hover:pointer-events-auto focus-within:pointer-events-auto">
            <MessageCopyButton value={message.body} />
          </div>
        )}
      </div>
    )
  }

  if (message.role === 'tool') {
    return <ToolCallRow message={message} />
  }

  if (message.role === 'system') {
    if (message.uiKind === 'compact') {
      return <CompactSystemCard body={message.body} />
    }

    return (
      <div className="border border-rc-border-soft bg-rc-sidebar rounded-lg px-3 py-2 text-[12px] text-rc-muted mono whitespace-pre-wrap">
        {message.body}
      </div>
    )
  }

  return (
    <div className="group relative">
      <div className="text-[13.5px] text-rc-text leading-[1.65]">
        <div className="markdown-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.body}
          </ReactMarkdown>
        </div>
      </div>
      {!isGenerating && (
        <div className="absolute left-0 top-full mt-1 z-10 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150 pointer-events-none group-hover:pointer-events-auto focus-within:pointer-events-auto">
          <MessageCopyButton value={message.body} />
        </div>
      )}
    </div>
  )
}

function CompactSystemCard({ body }: { body: string }) {
  return (
    <div className="tool-artifact">
      <div className="tool-artifact-header">
        <div className="min-w-0 flex items-center gap-2">
          <span className="tool-artifact-icon" aria-hidden="true">
            <Minimize2 className="h-3.5 w-3.5" strokeWidth={1.8} />
          </span>
          <span className="font-medium text-rc-text text-[12.5px]">Conversation compacted</span>
        </div>
      </div>
      <div className="text-[12.5px] leading-relaxed text-rc-muted">
        {body}
      </div>
    </div>
  )
}

function MessageCopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <button
      type="button"
      className="tool-action-button"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1200)
        })
      }}
      title={copied ? 'Copied' : 'Copy message'}
      aria-label={copied ? 'Copied' : 'Copy message'}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" strokeWidth={2} />
      ) : (
        <Copy className="h-3.5 w-3.5" strokeWidth={1.8} />
      )}
    </button>
  )
}

function getTranscriptSpacing(message: ChatMessage, previous: ChatMessage | undefined): string {
  if (!previous) return ''
  if (message.role === 'tool' && previous.role === 'tool') return 'mt-1'
  if (message.role === 'tool') return 'mt-3'
  if (previous.role === 'tool') return 'mt-5'
  if (message.role === 'system' || previous.role === 'system') return 'mt-4'
  return 'mt-7'
}

function ToolCallRow({ message }: { message: ChatMessage }) {
  if (message.toolKind === 'think') {
    const running = message.toolStatus === 'pending' || message.toolStatus === 'in_progress'
    const content = message.toolContent ?? (message.body === 'Thinking' ? '' : message.body)
    return (
      <ThinkingRow
        content={content}
        isStreaming={running}
      />
    )
  }

  const toolName = getToolName(message)
  const running = message.toolStatus === 'pending' || message.toolStatus === 'in_progress'
  const failed = message.toolStatus === 'failed'
  const subject = getToolSubject(message.body, toolName)
  const todos = toolName === 'TodoWrite' ? readTodos(message.toolInput, message.toolContent) : []
  const isTodo = toolName === 'TodoWrite' && todos.length > 0

  if (isTodo) {
    return <TodoToolCard todos={todos} running={running} failed={failed} />
  }

  if (toolName === 'AskUserQuestion') {
    return (
      <QuestionToolCard
        input={message.toolInput}
        content={message.toolContent}
        running={running}
        failed={failed}
      />
    )
  }

  return (
    <ExpandableToolRow
      message={message}
      toolName={toolName}
      running={running}
      failed={failed}
      subject={subject}
    />
  )
}

function ExpandableToolRow({
  message,
  toolName,
  running,
  failed,
  subject,
}: {
  message: ChatMessage
  toolName: string
  running: boolean
  failed: boolean
  subject: string
}) {
  const [open, setOpen] = useState(false)
  const content = message.toolContent ?? formatToolInput(message.toolInput)
  const isTask = toolName === 'Task'
  const filePath = getToolPath(message.toolInput)
  const command = typeof message.toolInput?.command === 'string' ? message.toolInput.command : subject
  const labelText = running
    ? `${runningVerb(toolName)}${subject ? ` ${subject}` : ''}`
    : `${readableToolName(toolName).toLowerCase()}${subject ? ` ${subject}` : ''}`

  return (
    <div className="text-[12.5px] mono leading-snug">
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1.5 text-left group"
      >
        {open ? (
          <ChevronDown
            className={'w-3.5 h-3.5 ' + (running ? 'tool-shimmer-icon' : 'text-rc-faint')}
            strokeWidth={2}
          />
        ) : (
          <ChevronRight
            className={'w-3.5 h-3.5 ' + (running ? 'tool-shimmer-icon' : 'text-rc-faint')}
            strokeWidth={2}
          />
        )}
        {failed && <XCircle className="w-3 h-3 text-red-500" strokeWidth={2} />}
        {running ? (
          <TextShimmer as="span" className="font-medium text-[12.5px]" duration={2}>
            {`${labelText}...`}
          </TextShimmer>
        ) : (
          <span className="font-medium tool-done-label group-hover:opacity-80 transition-opacity truncate max-w-[640px]">
            {labelText}
          </span>
        )}
      </button>
      {open && (
        <div className="ml-5 mt-1.5 pl-3 border-l border-rc-border-soft">
          {toolName === 'Edit' ? (
            <EditToolDetails input={message.toolInput} content={content} fallback={message.body} />
          ) : toolName === 'Bash' ? (
            <BashToolDetails command={command} content={content || message.body} failed={failed} running={running} />
          ) : toolName === 'Write' && filePath ? (
            <WriteToolDetails path={filePath} content={getWriteContent(message.toolInput, content || message.body)} />
          ) : toolName === 'Read' && filePath ? (
            <ReadToolDetails path={filePath} content={content || message.body} />
          ) : isTask ? (
            <TaskBody input={message.toolInput} content={content || message.body} />
          ) : (
            <pre className="mono max-h-[360px] overflow-auto whitespace-pre-wrap text-[11.5px] leading-relaxed text-rc-muted">
              {content || message.body}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

function ReadToolDetails({
  path,
  content,
}: {
  path: string
  content: string
}) {
  const lines = useMemo(() => splitContentLines(content), [content])
  return (
    <div className="file-tool-card">
      <FileToolHeader path={path} kind="read" lineCount={lines.length} content={content} />
      <NumberedCodeBlock lines={lines} kind="read" />
    </div>
  )
}

function WriteToolDetails({
  path,
  content,
}: {
  path: string
  content: string
}) {
  const lines = useMemo(() => splitContentLines(content), [content])
  return (
    <div className="file-tool-card">
      <FileToolHeader path={path} kind="write" lineCount={lines.length} content={content} />
      <NumberedCodeBlock lines={lines} kind="write" />
    </div>
  )
}

function FileToolHeader({
  path,
  kind,
  lineCount,
  content,
}: {
  path: string
  kind: 'read' | 'write' | 'edit'
  lineCount?: number
  content?: string
}) {
  const fileName = getFileName(path)
  const directory = getDirectory(path)
  const kindLabel = kind === 'read' ? 'read' : kind === 'write' ? 'created' : 'edited'
  const kindClass = `file-tool-kind file-tool-kind--${kind}`
  return (
    <div className="file-tool-header">
      <div className="min-w-0 flex items-center gap-2">
        <span className={'file-tool-icon file-tool-icon--' + kind} aria-hidden="true">
          <FileText className="h-3.5 w-3.5" strokeWidth={1.7} />
        </span>
        <span className="min-w-0 truncate">
          <span className="text-rc-text font-medium">{fileName}</span>
          {directory && <span className="text-rc-faint">{`  ${directory}`}</span>}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <span className={kindClass}>{kindLabel}</span>
        {typeof lineCount === 'number' && lineCount > 0 && (
          <span className="file-tool-lines">{lineCount === 1 ? '1 line' : `${lineCount} lines`}</span>
        )}
        {content !== undefined && content.length > 0 && (
          <CopyButton value={content} label="Copy contents" />
        )}
        <CopyButton value={path} label="Copy path" />
      </div>
    </div>
  )
}

function NumberedCodeBlock({
  lines,
  kind,
}: {
  lines: string[]
  kind: 'read' | 'write'
}) {
  if (lines.length === 0) {
    return <div className="file-tool-empty">empty file</div>
  }
  const { displayLines, hiddenCount } = clipDisplayLines(lines, 400)
  const gutterWidth = String(displayLines.length).length
  return (
    <div className={'file-tool-body file-tool-body--' + kind}>
      {displayLines.map((line, index) => (
        <div
          key={index}
          className={
            'file-tool-line file-tool-line--' + kind + (kind === 'read' ? ' file-tool-line--no-sign' : '')
          }
        >
          <span
            className="file-tool-line-number"
            style={{ minWidth: `${gutterWidth}ch` }}
          >
            {index + 1}
          </span>
          {kind === 'write' && <span className="file-tool-line-sign">+</span>}
          <span className="file-tool-line-code">{line.length === 0 ? '\u00A0' : line}</span>
        </div>
      ))}
      {hiddenCount > 0 && (
        <div className="file-tool-overflow">… {hiddenCount} more {hiddenCount === 1 ? 'line' : 'lines'} hidden</div>
      )}
    </div>
  )
}

function BashToolDetails({
  command,
  content,
  running,
  failed,
}: {
  command: string
  content: string
  running: boolean
  failed: boolean
}) {
  return (
    <div className="bash-tool-card">
      <div className="bash-tool-header">
        <span className="min-w-0 truncate">
          <span className="text-rc-faint">$ </span>
          <span className="text-rc-text">{command || 'bash'}</span>
        </span>
        <span className={'bash-status ' + (failed ? 'is-error' : running ? 'is-running' : 'is-done')}>
          {failed ? 'failed' : running ? 'running' : 'done'}
        </span>
      </div>
      <pre className="bash-tool-output">{content}</pre>
    </div>
  )
}

function CopyButton({
  value,
  label,
}: {
  value: string
  label: string
}) {
  const [copied, setCopied] = useState(false)

  return (
    <button
      className="tool-action-button"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1200)
        })
      }}
      title={label}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" strokeWidth={2} />
      ) : (
        <Copy className="h-3.5 w-3.5" strokeWidth={1.8} />
      )}
    </button>
  )
}

function TodoToolCard({
  todos,
  running,
  failed,
}: {
  todos: { content: string; status: string; priority?: string }[]
  running: boolean
  failed: boolean
}) {
  const completed = todos.filter((todo) => todo.status === 'completed').length
  const active = todos.filter((todo) => todo.status === 'in_progress').length
  const pending = todos.filter((todo) => todo.status === 'pending').length
  const progress = todos.length === 0 ? 0 : Math.round((completed / todos.length) * 100)

  return (
    <div className="tool-artifact tool-artifact-todo">
      <div className="tool-artifact-header">
        <div className="min-w-0 flex items-center gap-2">
          <span className="tool-artifact-icon tool-artifact-icon--todo" aria-hidden="true">
            <ListChecks className="h-3.5 w-3.5" strokeWidth={1.8} />
          </span>
          <span className="font-medium text-rc-text text-[12.5px]">Task plan</span>
          {running && (
            <TextShimmer as="span" className="text-[11.5px]" duration={2}>
              updating…
            </TextShimmer>
          )}
          {failed && (
            <span className="tool-artifact-badge tool-artifact-badge--error">failed</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-[10.5px]">
          <span className="tool-artifact-count">
            <span className="tool-artifact-count-value">{completed}</span>
            <span className="tool-artifact-count-divider">/</span>
            <span className="tool-artifact-count-total">{todos.length}</span>
          </span>
          {active > 0 && (
            <span className="tool-artifact-pill tool-artifact-pill--active">{active} active</span>
          )}
          {pending > 0 && (
            <span className="tool-artifact-pill tool-artifact-pill--pending">{pending} pending</span>
          )}
        </div>
      </div>
      {todos.length > 0 && (
        <div
          className="tool-artifact-progress"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${completed} of ${todos.length} tasks completed`}
        >
          <div
            className="tool-artifact-progress-fill"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
      <TodoList todos={todos} />
    </div>
  )
}

function QuestionToolCard({
  input,
  content,
  running,
  failed,
}: {
  input: Record<string, unknown> | undefined
  content: string | undefined
  running: boolean
  failed: boolean
}) {
  const payload = readQuestionPayload(input, content)
  const questions = payload?.questions ?? []

  const title = running
    ? 'Needs your input'
    : failed
      ? 'Question failed'
      : payload?.dismissed
        ? 'Question dismissed'
        : 'Your answer'

  return (
    <div
      className={
        'tool-artifact tool-artifact-question' +
        (running ? ' is-waiting' : '') +
        (failed ? ' is-failed' : '')
      }
    >
      <div className="tool-artifact-header">
        <div className="min-w-0 flex items-center gap-2">
          <span className="tool-artifact-icon tool-artifact-icon--question" aria-hidden="true">
            <HelpCircle className="h-3.5 w-3.5" strokeWidth={1.8} />
          </span>
          <span className="font-medium text-rc-text text-[12.5px]">{title}</span>
          {running && (
            <TextShimmer as="span" className="text-[11.5px]" duration={2}>
              waiting…
            </TextShimmer>
          )}
        </div>
        <span className="tool-artifact-count">
          <span className="tool-artifact-count-value">{questions.length}</span>
          <span className="tool-artifact-count-label">
            {questions.length === 1 ? 'question' : 'questions'}
          </span>
        </span>
      </div>
      <div className="space-y-2">
        {questions.map((question) => {
          const answer = payload?.dismissed === false
            ? payload.answers.find((item) => item.questionId === question.id)
            : undefined
          const selections = answer?.selectedOptionLabels ?? []
          const customText = answer?.customText.trim() ?? ''
          return (
            <div key={question.id} className="question-artifact-item">
              <div className="text-[12px] font-medium text-rc-text">{question.header}</div>
              <div className="mt-0.5 text-[11.5px] leading-relaxed text-rc-muted">
                {question.question}
              </div>
              {running ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {question.options.map((option) => (
                    <span key={option.label} className="question-artifact-option">
                      {option.label}
                    </span>
                  ))}
                </div>
              ) : payload?.dismissed ? (
                <div className="mt-2 text-[11.5px] text-rc-faint">Dismissed</div>
              ) : (
                <div className="mt-2 space-y-1">
                  {selections.length > 0 && (
                    <div className="text-[11.5px] text-rc-text">
                      {selections.join(', ')}
                    </div>
                  )}
                  {customText && (
                    <div className="rounded-md border border-rc-border-soft bg-rc-bg px-2 py-1.5 text-[11.5px] text-rc-muted">
                      {customText}
                    </div>
                  )}
                  {selections.length === 0 && customText === '' && (
                    <div className="text-[11.5px] text-rc-faint">No answer</div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function EditToolDetails({
  input,
  content,
  fallback,
}: {
  input: Record<string, unknown> | undefined
  content: string
  fallback: string
}) {
  const preview = readEditPreview(input)
  const path = preview.path || getPathFromDiff(content) || 'file'
  const edits = preview.edits

  const stats = useMemo(() => {
    let added = 0
    let removed = 0
    for (const edit of edits) {
      removed += countNonEmptyLines(edit.oldText)
      added += countNonEmptyLines(edit.newText)
    }
    return { added, removed }
  }, [edits])

  if (edits.length === 0) {
    return (
      <div className="file-tool-card">
        <FileToolHeader path={path} kind="edit" />
        <pre className="mono max-h-[360px] m-0 overflow-auto whitespace-pre-wrap text-[11.5px] leading-relaxed text-rc-muted px-3 py-2.5">
          {content || fallback}
        </pre>
      </div>
    )
  }

  return (
    <div className="file-tool-card edit-preview-card">
      <div className="file-tool-header">
        <div className="min-w-0 flex items-center gap-2">
          <span className="file-tool-icon file-tool-icon--edit" aria-hidden="true">
            <FileText className="h-3.5 w-3.5" strokeWidth={1.7} />
          </span>
          <span className="min-w-0 truncate">
            <span className="text-rc-text font-medium">{getFileName(path)}</span>
            {getDirectory(path) && (
              <span className="text-rc-faint">{`  ${getDirectory(path)}`}</span>
            )}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="file-tool-kind file-tool-kind--edit">edited</span>
          <span className="diff-stat diff-stat--added">+{stats.added}</span>
          <span className="diff-stat diff-stat--removed">-{stats.removed}</span>
          <CopyButton value={path} label="Copy path" />
        </div>
      </div>
      <div className="edit-preview-body">
        {edits.slice(0, 4).map((edit, index) => (
          <UnifiedDiffHunk key={`${index}-${edit.oldText.slice(0, 20)}`} edit={edit} index={index} />
        ))}
        {edits.length > 4 && (
          <div className="edit-preview-overflow">
            {edits.length - 4} more {edits.length - 4 === 1 ? 'replacement' : 'replacements'} hidden
          </div>
        )}
      </div>
    </div>
  )
}

function UnifiedDiffHunk({
  edit,
  index,
}: {
  edit: { oldText: string; newText: string }
  index: number
}) {
  const oldLines = createDiffPreviewLines(edit.oldText)
  const newLines = createDiffPreviewLines(edit.newText)
  return (
    <div className="diff-hunk">
      <div className="diff-hunk-header">
        <span className="diff-hunk-marker">@@</span>
        <span className="diff-hunk-label">Hunk {index + 1}</span>
      </div>
      <div className="diff-hunk-body">
        {oldLines.map((line, i) => (
          <div key={`o-${i}`} className="diff-line diff-line--removed">
            <span className="diff-line-sign">-</span>
            <span className="diff-line-code">{line.length === 0 ? '\u00A0' : line}</span>
          </div>
        ))}
        {newLines.map((line, i) => (
          <div key={`n-${i}`} className="diff-line diff-line--added">
            <span className="diff-line-sign">+</span>
            <span className="diff-line-code">{line.length === 0 ? '\u00A0' : line}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Map tool name → present-progressive verb shown during shimmer.
 */
function runningVerb(toolName: string): string {
  switch (toolName) {
    case 'Read':
      return 'Reading'
    case 'Edit':
      return 'Editing'
    case 'Write':
      return 'Writing'
    case 'Bash':
      return 'Running'
    case 'Task':
      return 'Running task'
    case 'Grep':
      return 'Searching'
    case 'Glob':
      return 'Globbing'
    case 'TodoWrite':
      return 'Updating todos'
    default:
      return toolName
  }
}

/**
 * Lowercase, human readable form of the tool name for the collapsed row.
 */
function readableToolName(toolName: string): string {
  switch (toolName) {
    case 'Read':
      return 'read'
    case 'Edit':
      return 'edit'
    case 'Write':
      return 'write'
    case 'Bash':
      return 'bash'
    case 'Task':
      return 'task'
    case 'Grep':
      return 'grep'
    case 'Glob':
      return 'glob'
    case 'TodoWrite':
      return 'Todos'
    default:
      return toolName
  }
}

function getToolPath(input: Record<string, unknown> | undefined): string {
  return typeof input?.path === 'string' ? input.path : ''
}

function getWriteContent(
  input: Record<string, unknown> | undefined,
  fallback: string,
): string {
  if (typeof input?.content === 'string' && input.content.length > 0) return input.content
  return fallback
}

function getFileName(path: string): string {
  if (!path) return ''
  const normalized = path.replace(/\\/g, '/')
  const idx = normalized.lastIndexOf('/')
  return idx === -1 ? normalized : normalized.slice(idx + 1)
}

function getDirectory(path: string): string {
  if (!path) return ''
  const normalized = path.replace(/\\/g, '/')
  const idx = normalized.lastIndexOf('/')
  return idx === -1 ? '' : normalized.slice(0, idx)
}

function splitContentLines(content: string): string[] {
  if (!content) return []
  const trimmed = content.replace(/\n$/u, '')
  if (trimmed.length === 0) return []
  return trimmed.split('\n')
}

function clipDisplayLines(lines: string[], max: number): { displayLines: string[]; hiddenCount: number } {
  if (lines.length <= max) return { displayLines: lines, hiddenCount: 0 }
  return { displayLines: lines.slice(0, max), hiddenCount: lines.length - max }
}

function countNonEmptyLines(value: string): number {
  if (!value) return 0
  return value.split('\n').filter((line) => line.trim().length > 0).length
}

function TaskBody({
  input,
  content,
}: {
  input: Record<string, unknown> | undefined
  content: string
}) {
  const description = typeof input?.description === 'string' ? input.description : undefined
  const prompt = typeof input?.prompt === 'string' ? input.prompt : undefined
  const subagent =
    typeof input?.subagentType === 'string'
      ? input.subagentType
      : typeof input?.subagent_type === 'string'
        ? input.subagent_type
        : undefined

  return (
    <div className="divide-y divide-rc-border-soft">
      {(description || subagent) && (
        <div className="px-3 py-2 flex items-center gap-3 bg-rc-sidebar">
          {description && (
            <span className="text-[12px] font-medium text-rc-text">{description}</span>
          )}
          {subagent && (
            <span className="text-[10.5px] uppercase tracking-wider text-rc-faint mono">
              {subagent}
            </span>
          )}
        </div>
      )}
      {prompt && (
        <div className="px-3 py-2.5">
          <div className="text-[10.5px] uppercase tracking-wider text-rc-faint mb-1">
            Prompt
          </div>
          <pre className="mono max-h-[180px] overflow-auto whitespace-pre-wrap text-[11.5px] leading-relaxed text-rc-muted">
            {prompt}
          </pre>
        </div>
      )}
      {content && (
        <div className="px-3 py-2.5">
          <div className="text-[10.5px] uppercase tracking-wider text-rc-faint mb-1">
            Result
          </div>
          <pre className="mono max-h-[260px] overflow-auto whitespace-pre-wrap text-[11.5px] leading-relaxed text-rc-text">
            {content}
          </pre>
        </div>
      )}
    </div>
  )
}

function TodoStatusIcon({ status }: { status: string }) {
  if (status === 'completed') {
    return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--success)]" strokeWidth={1.8} aria-hidden="true" />
  }
  if (status === 'in_progress') {
    return <Loader2 className="h-3.5 w-3.5 shrink-0 text-[var(--info)]" strokeWidth={1.8} aria-hidden="true" />
  }
  if (status === 'cancelled') {
    return <XCircle className="h-3.5 w-3.5 shrink-0 opacity-40" strokeWidth={1.8} aria-hidden="true" />
  }
  return <Circle className="h-3.5 w-3.5 shrink-0 text-rc-faint" strokeWidth={1.8} aria-hidden="true" />
}

function TodoList({
  todos,
}: {
  todos: { content: string; status: string; priority?: string }[]
}) {
  return (
    <div className="space-y-2">
      {todos.map((todo, index) => {
        const done = todo.status === 'completed'
        const active = todo.status === 'in_progress'
        const cancelled = todo.status === 'cancelled'
        return (
          <div key={`${todo.content}-${index}`} className="flex items-start gap-2.5">
            <div className="mt-[1px]">
              <TodoStatusIcon status={todo.status} />
            </div>
            <div className="min-w-0 leading-snug">
              <div
                className={
                  'text-[12.5px] ' +
                  (done
                    ? 'text-rc-muted line-through'
                    : active
                      ? 'text-rc-text font-medium'
                      : cancelled
                        ? 'text-rc-faint line-through'
                        : 'text-rc-text')
                }
              >
                {todo.content}
              </div>
              <div className="text-[11px] text-rc-faint">
                {todo.status}
                {todo.priority ? ` · ${todo.priority}` : ''}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function getToolName(message: ChatMessage): string {
  const first = message.body.split(':')[0]?.trim()
  return first && first.length > 0 ? first : 'Tool'
}

function getToolSubject(body: string, toolName: string): string {
  const prefix = `${toolName}:`
  return body.startsWith(prefix) ? body.slice(prefix.length).trim() : body
}

function formatToolInput(input: Record<string, unknown> | undefined): string {
  if (!input) return ''
  return JSON.stringify(input, null, 2)
}

function readTodos(input: Record<string, unknown> | undefined, content: string | undefined): { content: string; status: string; priority?: string }[] {
  const rawTodos = input?.todos
  if (Array.isArray(rawTodos)) {
    return rawTodos.filter(isRecord).map((todo) => ({
      content: typeof todo.content === 'string' ? todo.content : '',
      status: typeof todo.status === 'string' ? todo.status : 'pending',
      priority: typeof todo.priority === 'string' ? todo.priority : undefined,
    })).filter((todo) => todo.content.length > 0)
  }
  if (!content) return []
  return content.split('\n').map((line) => {
    const match = /^(pending|in_progress|completed|cancelled):\s*(.+)$/u.exec(line.trim())
    return match ? { status: match[1]!, content: match[2]! } : undefined
  }).filter((todo): todo is { content: string; status: string } => todo !== undefined)
}

interface QuestionOptionPreview {
  label: string
  description: string
}

interface QuestionPreview {
  id: string
  header: string
  question: string
  options: QuestionOptionPreview[]
}

interface QuestionAnswerPreview {
  questionId: string
  selectedOptionLabels: string[]
  customText: string
}

type QuestionPayloadPreview =
  | { dismissed: true; questions: QuestionPreview[] }
  | { dismissed: false; questions: QuestionPreview[]; answers: QuestionAnswerPreview[] }

function readQuestionPayload(input: Record<string, unknown> | undefined, content: string | undefined): QuestionPayloadPreview | undefined {
  const fromContent = readQuestionPayloadFromContent(content)
  if (fromContent !== undefined) return fromContent
  const questions = readQuestionList(input?.questions)
  return questions.length === 0 ? undefined : { dismissed: false, questions, answers: [] }
}

function readQuestionPayloadFromContent(content: string | undefined): QuestionPayloadPreview | undefined {
  if (!content) return undefined
  try {
    const value: unknown = JSON.parse(content)
    if (!isRecord(value)) return undefined
    const questions = readQuestionList(value.questions)
    if (questions.length === 0) return undefined
    if (value.dismissed === true) return { dismissed: true, questions }
    const answers = Array.isArray(value.answers)
      ? value.answers.filter(isRecord).map((answer) => ({
        questionId: typeof answer.questionId === 'string' ? answer.questionId : '',
        selectedOptionLabels: Array.isArray(answer.selectedOptionLabels)
          ? answer.selectedOptionLabels.filter((item): item is string => typeof item === 'string')
          : [],
        customText: typeof answer.customText === 'string' ? answer.customText : '',
      })).filter((answer) => answer.questionId.length > 0)
      : []
    return { dismissed: false, questions, answers }
  } catch {
    return undefined
  }
}

function readQuestionList(value: unknown): QuestionPreview[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).map((question) => ({
    id: typeof question.id === 'string' ? question.id : '',
    header: typeof question.header === 'string' ? question.header : 'Question',
    question: typeof question.question === 'string' ? question.question : '',
    options: Array.isArray(question.options)
      ? question.options.filter(isRecord).map((option) => ({
        label: typeof option.label === 'string' ? option.label : '',
        description: typeof option.description === 'string' ? option.description : '',
      })).filter((option) => option.label.length > 0)
      : [],
  })).filter((question) => question.id.length > 0 && question.question.length > 0)
}

function readEditPreview(input: Record<string, unknown> | undefined): { path: string; edits: { oldText: string; newText: string }[] } {
  const path = typeof input?.path === 'string' ? input.path : ''
  if (Array.isArray(input?.edits)) {
    return {
      path,
      edits: input.edits.filter(isRecord).map((edit) => ({
        oldText: typeof edit.oldText === 'string' ? edit.oldText : '',
        newText: typeof edit.newText === 'string' ? edit.newText : '',
      })).filter((edit) => edit.oldText.length > 0 || edit.newText.length > 0),
    }
  }
  const oldText = typeof input?.oldText === 'string' ? input.oldText : ''
  const newText = typeof input?.newText === 'string' ? input.newText : ''
  return {
    path,
    edits: oldText.length > 0 || newText.length > 0 ? [{ oldText, newText }] : [],
  }
}

function getPathFromDiff(content: string): string {
  const firstLine = content.split('\n').find((line) => line.startsWith('--- '))
  return firstLine?.slice(4).trim() ?? ''
}

function createDiffPreviewLines(value: string): string[] {
  const lines = value.split('\n')
  const limited = lines.slice(0, 16)
  const totalLength = limited.join('\n').length
  const clipped = totalLength > 2200 ? limited.join('\n').slice(0, 2200).split('\n') : limited
  if (lines.length > 16) {
    return [...clipped, `... ${lines.length - 16} more lines`]
  }
  return clipped.length === 0 ? [''] : clipped
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
