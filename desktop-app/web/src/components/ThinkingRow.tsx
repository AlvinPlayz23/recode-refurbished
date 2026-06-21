/**
 * Dedicated reasoning/thinking transcript row for ACP think updates.
 */

import { Brain, ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '../lib/cn'
import { TextShimmer } from './TextShimmer'

const MS_IN_S = 1000

interface ThinkingRowProps {
  content: string
  isStreaming: boolean
}

export function ThinkingRow({ content, isStreaming }: ThinkingRowProps) {
  const [open, setOpen] = useState(isStreaming)
  const [duration, setDuration] = useState<number | undefined>(undefined)
  const startTime = useRef<number | undefined>(isStreaming ? Date.now() : undefined)
  const wasStreaming = useRef(isStreaming)
  const hasContent = content.trim().length > 0
  const durationLabel = duration === undefined
    ? 'Thought for a few seconds'
    : `Thought for ${duration} ${duration === 1 ? 'second' : 'seconds'}`

  useEffect(() => {
    if (isStreaming && startTime.current === undefined) {
      startTime.current = Date.now()
    }

    if (wasStreaming.current && !isStreaming) {
      if (startTime.current !== undefined) {
        setDuration(Math.max(1, Math.ceil((Date.now() - startTime.current) / MS_IN_S)))
      }
      setOpen(false)
      startTime.current = undefined
    }

    if (isStreaming) {
      setOpen(true)
    }

    wasStreaming.current = isStreaming
  }, [isStreaming])

  return (
    <div className="thinking-row">
      <button
        type="button"
        className="thinking-row-trigger group"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <Brain className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
        {isStreaming ? (
          <TextShimmer as="span" className="thinking-row-label" duration={2}>
            Thinking...
          </TextShimmer>
        ) : (
          <span className="thinking-row-label">
            {durationLabel}
          </span>
        )}
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 transition-transform duration-150',
            open ? 'rotate-180' : 'rotate-0',
          )}
          strokeWidth={1.8}
          aria-hidden="true"
        />
      </button>
      {hasContent && (
        <div className="thinking-row-content" data-state={open ? 'open' : 'closed'}>
          <div className="markdown-body thinking-row-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {content}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  )
}
