/**
 * Static mock data so the UI looks alive without any backend wiring.
 */

import type { Project, Thread } from './types'

export const initialProjects: Project[] = [
  {
    id: 'recode-scratch',
    name: 'recode-scratch',
    path: '~/work/recode-scratch',
  },
  {
    id: 'shot-scraper',
    name: 'shot-scraper',
    path: '~/oss/shot-scraper',
  },
]

export interface PickerEntry {
  id: string
  name: string
  path: string
}

export const pickerProjects: PickerEntry[] = [
  {
    id: 'marketing-frontend',
    name: 'marketing-frontend',
    path: '~/projects/marketing-frontend',
  },
  {
    id: 'inventory-api',
    name: 'inventory-api',
    path: '~/work/api-v2',
  },
  {
    id: 'data-pipeline',
    name: 'data-pipeline',
    path: '~/oss/data-engine',
  },
]

export const initialThreads: Thread[] = [
  {
    id: 'thread-1',
    projectId: 'shot-scraper',
    title: 'Document shot-scraper CLI usage',
    model: 'Recode default',
    age: '2h',
    badge: 'branch',
  },
  {
    id: 'thread-2',
    projectId: 'shot-scraper',
    title: 'Add --wait-for-network flag',
    model: 'Recode default',
    age: '18h',
  },
  {
    id: 'thread-3',
    projectId: 'shot-scraper',
    title: 'Refactor screenshot pipeline',
    model: 'Recode default',
    age: '1d',
  },
  {
    id: 'thread-4',
    projectId: 'recode-scratch',
    title: 'Wire up acp-server flag parsing',
    model: 'Recode default',
    age: '3h',
    badge: 'branch',
  },
  {
    id: 'thread-5',
    projectId: 'recode-scratch',
    title: 'Investigate hung tool calls on Windows',
    model: 'Recode default',
    age: '2d',
  },
]
