/**
 * Settings panel for app preferences.
 *
 * Refined surface: rail-and-panel layout, coss Switch primitive for toggles,
 * subtle motion on the panel card, and section headers with eyebrows.
 */

import { useEffect, useRef, useState } from 'react'
import {
  Bell,
  Check,
  ChevronRight,
  Cog,
  Cpu,
  Folder,
  Moon,
  Palette,
  ShieldCheck,
  Sun,
  X,
} from 'lucide-react'
import gsap from 'gsap'
import { cn } from '../lib/cn'
import { Switch } from './ui/switch'
import type { ThemeMode } from '../types'
import type { RecodeRuntimeMode } from '../desktop-rpc'

interface SettingsModalProps {
  open: boolean
  theme: ThemeMode
  gpuAccelerationDisabled: boolean
  runtimeMode: RecodeRuntimeMode
  recodeRepoRoot?: string
  detectedRepoRoot?: string
  onClose: () => void
  onChangeTheme: (theme: ThemeMode) => void
  onChangeGpuAccelerationDisabled: (disabled: boolean) => void
  onChangeRuntimeMode: (mode: RecodeRuntimeMode) => void
  onChooseRecodeRepo: () => void
}

const SECTIONS = [
  { id: 'General', icon: Cog },
  { id: 'Models', icon: Cpu },
  { id: 'Approval', icon: ShieldCheck },
  { id: 'Appearance', icon: Palette },
  { id: 'Notifications', icon: Bell },
] as const
type Section = (typeof SECTIONS)[number]['id']

export function SettingsModal({
  open,
  theme,
  gpuAccelerationDisabled,
  runtimeMode,
  recodeRepoRoot,
  detectedRepoRoot,
  onClose,
  onChangeTheme,
  onChangeGpuAccelerationDisabled,
  onChangeRuntimeMode,
  onChooseRecodeRepo,
}: SettingsModalProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [section, setSection] = useState<Section>('General')

  useEffect(() => {
    if (document.documentElement.dataset.animations === 'paused') return
    if (open && cardRef.current) {
      gsap.fromTo(
        cardRef.current,
        { scale: 0.97, opacity: 0, y: 8 },
        { scale: 1, opacity: 1, y: 0, duration: 0.22, ease: 'expo.out' },
      )
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

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-6">
      <div
        className="absolute inset-0 bg-black/35 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        ref={cardRef}
        className={cn(
          'relative bg-rc-elevated border border-rc-border w-full max-w-[760px] h-[500px]',
          'rounded-2xl shadow-2xl overflow-hidden flex',
        )}
      >
        {/* left rail */}
        <div className="w-[180px] shrink-0 bg-rc-sidebar border-r border-rc-border-soft p-2.5 flex flex-col">
          <div className="px-2 py-2 flex items-center gap-2">
            <span className="display text-[13px] font-semibold text-rc-text">
              Settings
            </span>
          </div>
          <div className="mt-1 flex flex-col gap-0.5">
            {SECTIONS.map(({ id, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                className={cn(
                  'group relative w-full text-left px-2.5 py-1.5 rounded-md',
                  'flex items-center gap-2 text-[12.5px] transition-colors',
                  section === id
                    ? 'bg-rc-hover-strong text-rc-text'
                    : 'text-rc-muted hover:text-rc-text hover:bg-rc-hover',
                )}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" strokeWidth={1.7} />
                <span className="flex-1">{id}</span>
                {section === id && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[2px] rounded-r bg-rc-accent" />
                )}
              </button>
            ))}
          </div>
          <div className="mt-auto px-2 py-2 text-[10.5px] text-rc-faint">
            Recode v0.1.0 · {runtimeMode}
          </div>
        </div>

        {/* main */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="h-12 px-5 flex items-center justify-between border-b border-rc-border-soft">
            <div className="flex items-baseline gap-2">
              <span className="display text-[14px] font-semibold text-rc-text">
                {section}
              </span>
              <span className="text-[11px] text-rc-faint">
                {sectionDescription(section)}
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className={cn(
                'w-7 h-7 rounded-md flex items-center justify-center',
                'text-rc-muted hover:text-rc-text hover:bg-rc-hover',
                'transition-colors focus-ring',
              )}
              title="Close"
            >
              <X className="w-4 h-4" strokeWidth={1.5} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {section === 'General' && (
              <SectionStack>
                <Row label="Account" value="Personal" />
                <RuntimeModeRow
                  runtimeMode={runtimeMode}
                  recodeRepoRoot={recodeRepoRoot}
                  detectedRepoRoot={detectedRepoRoot}
                  onChangeRuntimeMode={onChangeRuntimeMode}
                  onChooseRecodeRepo={onChooseRecodeRepo}
                />
                <Row label="Auto-open last session" toggle />
                <Row label="Confirm on quit" toggle defaultOn />
              </SectionStack>
            )}
            {section === 'Models' && (
              <SectionStack>
                <Row label="Default model" value="Recode configured default" />
                <Row label="Default reasoning" value="Medium" />
                <Row label="Stream tool output" toggle defaultOn />
                <Row label="Show reasoning previews" toggle />
              </SectionStack>
            )}
            {section === 'Approval' && (
              <SectionStack>
                <Row label="Approval mode" value="auto-edits" />
                <Row label="Bash needs approval" toggle defaultOn />
                <Row label="Edits need approval" toggle />
                <Row label="Network calls need approval" toggle defaultOn />
              </SectionStack>
            )}
            {section === 'Appearance' && (
              <SectionStack>
                <ThemeRow theme={theme} onChangeTheme={onChangeTheme} />
                <Row label="Compact sidebar" toggle />
                <Row label="Show status bar" toggle />
                <Row label="Reduce motion" toggle />
                <GpuAccelerationRow
                  disabled={gpuAccelerationDisabled}
                  onChangeDisabled={onChangeGpuAccelerationDisabled}
                />
              </SectionStack>
            )}
            {section === 'Notifications' && (
              <SectionStack>
                <Row label="Sound on completion" toggle />
                <Row label="Notify on tool approval" toggle defaultOn />
                <Row label="Notify on errors" toggle defaultOn />
              </SectionStack>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function sectionDescription(s: Section): string {
  switch (s) {
    case 'General':
      return 'Workspace, runtime, and session preferences'
    case 'Models':
      return 'Model defaults and tool output behavior'
    case 'Approval':
      return 'Control which actions require confirmation'
    case 'Appearance':
      return 'Theme, density, and motion preferences'
    case 'Notifications':
      return 'When and how Recode notifies you'
  }
}

function SectionStack({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col rounded-xl border border-rc-border-soft bg-rc-card divide-y divide-rc-border-soft">
      {children}
    </div>
  )
}

function RuntimeModeRow({
  runtimeMode,
  recodeRepoRoot,
  detectedRepoRoot,
  onChangeRuntimeMode,
  onChooseRecodeRepo,
}: {
  runtimeMode: RecodeRuntimeMode
  recodeRepoRoot?: string
  detectedRepoRoot?: string
  onChangeRuntimeMode: (mode: RecodeRuntimeMode) => void
  onChooseRecodeRepo: () => void
}) {
  return (
    <div className="px-3.5 py-3 space-y-2.5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-[12.5px] text-rc-text font-medium">
            Runtime mode
          </span>
          <span className="text-[11px] text-rc-muted">
            Where the Recode CLI runs from.
          </span>
        </div>
        <span className="mono text-[10.5px] text-rc-faint uppercase tracking-wider">
          {runtimeMode}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <ModeButton
          active={runtimeMode === 'dev'}
          label="Dev"
          hint="Local checkout"
          onClick={() => onChangeRuntimeMode('dev')}
        />
        <ModeButton
          active={runtimeMode === 'prod'}
          label="Prod"
          hint="Bundled binary"
          onClick={() => onChangeRuntimeMode('prod')}
        />
      </div>
      <div className="rounded-lg border border-rc-border-soft bg-rc-bg px-3 py-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-rc-faint mb-1 font-semibold">
              <Folder className="w-3 h-3" strokeWidth={1.8} />
              Recode repo
            </div>
            <div className="text-[11.5px] mono text-rc-muted break-all">
              {recodeRepoRoot ?? detectedRepoRoot ?? 'Not configured'}
            </div>
          </div>
          <button
            type="button"
            onClick={onChooseRecodeRepo}
            className={cn(
              'shrink-0 px-2.5 py-1.5 rounded-md border border-rc-border bg-rc-card',
              'text-[12px] text-rc-text hover:bg-rc-hover transition-colors focus-ring',
            )}
          >
            Choose
          </button>
        </div>
      </div>
    </div>
  )
}

function ModeButton({
  active,
  label,
  hint,
  onClick,
}: {
  active: boolean
  label: string
  hint?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-12 rounded-lg border px-3 flex items-center justify-between transition-colors focus-ring',
        active
          ? 'border-rc-accent bg-rc-accent-soft text-rc-accent'
          : 'border-rc-border bg-rc-card text-rc-text hover:bg-rc-hover',
      )}
    >
      <div className="flex flex-col items-start">
        <span className="text-[12.5px] font-medium leading-tight">{label}</span>
        {hint && (
          <span
            className={cn(
              'text-[10.5px] leading-tight mt-0.5',
              active ? 'text-rc-accent/80' : 'text-rc-faint',
            )}
          >
            {hint}
          </span>
        )}
      </div>
      {active && <Check className="w-3.5 h-3.5" strokeWidth={2.2} />}
    </button>
  )
}

function ThemeRow({
  theme,
  onChangeTheme,
}: {
  theme: ThemeMode
  onChangeTheme: (theme: ThemeMode) => void
}) {
  return (
    <div className="px-3.5 py-3 space-y-2.5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-[12.5px] text-rc-text font-medium">Theme</span>
          <span className="text-[11px] text-rc-muted">
            Tune the canvas to your environment.
          </span>
        </div>
        <span className="mono text-[10.5px] text-rc-faint uppercase tracking-wider capitalize">
          {theme}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <ThemeButton
          active={theme === 'light'}
          icon={<Sun className="w-3.5 h-3.5" strokeWidth={1.8} />}
          label="Light"
          onClick={() => onChangeTheme('light')}
        />
        <ThemeButton
          active={theme === 'dark'}
          icon={<Moon className="w-3.5 h-3.5" strokeWidth={1.8} />}
          label="Dark"
          onClick={() => onChangeTheme('dark')}
        />
      </div>
    </div>
  )
}

function GpuAccelerationRow({
  disabled,
  onChangeDisabled,
}: {
  disabled: boolean
  onChangeDisabled: (disabled: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-3.5 py-2.5">
      <div className="flex flex-col">
        <span className="text-[12.5px] text-rc-text">GPU acceleration</span>
        <span className="text-[11px] text-rc-muted">
          Turning this off pauses app animations immediately.
        </span>
      </div>
      <Switch
        checked={!disabled}
        onCheckedChange={(enabled) => onChangeDisabled(!enabled)}
        aria-label="GPU acceleration"
      />
    </div>
  )
}

function ThemeButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-10 rounded-lg border px-3 flex items-center justify-between transition-colors focus-ring',
        'text-[12.5px]',
        active
          ? 'border-rc-accent bg-rc-accent-soft text-rc-accent'
          : 'border-rc-border bg-rc-card text-rc-text hover:bg-rc-hover',
      )}
    >
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>
      {active && <Check className="w-3.5 h-3.5" strokeWidth={2.2} />}
    </button>
  )
}

function Row({
  label,
  value,
  toggle,
  defaultOn,
}: {
  label: string
  value?: string
  toggle?: boolean
  defaultOn?: boolean
}) {
  const [on, setOn] = useState(!!defaultOn)
  return (
    <div className="flex items-center justify-between gap-4 px-3.5 py-2.5">
      <span className="text-[12.5px] text-rc-text">{label}</span>
      {toggle ? (
        <Switch
          checked={on}
          onCheckedChange={(next) => setOn(next)}
          aria-label={label}
        />
      ) : value != null ? (
        <span className="flex items-center gap-1 text-[12px] text-rc-muted">
          {value}
          <ChevronRight className="w-3 h-3 text-rc-faint" strokeWidth={1.7} />
        </span>
      ) : null}
    </div>
  )
}
