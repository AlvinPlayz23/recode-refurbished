/**
 * Inline dropdown shown under the hero ("Working in <project> ▾"). Lists every
 * project/workspace so the user can switch where this new thread will land.
 *
 * Built on the coss Menu primitive (Base UI) for proper a11y, focus
 * management, and portal stacking — replaces a hand-rolled dropdown.
 */

import { Check, ChevronDown, Folder } from 'lucide-react'
import { cn } from '../lib/cn'
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from './ui/menu'
import type { Project } from '../types'

interface ProjectPickerProps {
  projects: Project[]
  activeProjectId: string | null
  onSelectProject: (id: string) => void
}

export function ProjectThreadPicker({
  projects,
  activeProjectId,
  onSelectProject,
}: ProjectPickerProps) {
  const active = projects.find((p) => p.id === activeProjectId) ?? null

  return (
    <Menu>
      <MenuTrigger
        className={cn(
          'group inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md align-middle',
          'text-rc-text font-medium hover:bg-rc-hover transition-colors',
          'data-[popup-open]:bg-rc-hover focus-ring',
        )}
      >
        <span>{active?.name ?? 'no workspace'}</span>
        <ChevronDown
          className="w-3 h-3 text-rc-muted transition-transform group-data-[popup-open]:rotate-180"
          strokeWidth={2}
        />
      </MenuTrigger>
      <MenuPopup
        align="center"
        sideOffset={6}
        className="min-w-[280px] max-w-[380px] p-1"
      >
        {projects.length === 0 ? (
          <div className="px-2.5 py-2 text-[12px] text-rc-muted">
            No workspaces yet.
          </div>
        ) : (
          <MenuGroup>
            <MenuGroupLabel className="px-2.5 pt-1.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-rc-faint">
              Switch workspace
            </MenuGroupLabel>
            <div
              className="overflow-y-auto"
              style={{ maxHeight: 280 }}
            >
              {projects.map((p) => {
                const isActive = p.id === activeProjectId
                return (
                  <MenuItem
                    key={p.id}
                    onClick={() => onSelectProject(p.id)}
                    className={cn(
                      'flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer',
                      'text-[12.5px] text-rc-text outline-none',
                      'data-[highlighted]:bg-rc-hover',
                      isActive && 'bg-rc-hover-strong',
                    )}
                  >
                    <Folder
                      className={cn(
                        'w-3.5 h-3.5 shrink-0',
                        isActive ? 'text-rc-accent' : 'text-rc-muted',
                      )}
                      strokeWidth={1.5}
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block truncate">{p.name}</span>
                      <span className="block text-[10.5px] mono text-rc-faint truncate">
                        {p.path}
                      </span>
                    </span>
                    {isActive && (
                      <Check
                        className="w-3 h-3 text-rc-accent shrink-0"
                        strokeWidth={2.2}
                      />
                    )}
                  </MenuItem>
                )
              })}
            </div>
          </MenuGroup>
        )}
      </MenuPopup>
    </Menu>
  )
}
