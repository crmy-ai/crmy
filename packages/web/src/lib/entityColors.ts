// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Canonical entity color tokens — single source of truth used by the
 * Sidebar active indicator, Command Palette icons, and any other place
 * entity types are colour-coded throughout the app.
 */
export const ENTITY_COLORS = {
  dashboard:     { text: 'text-[#14b8a6]',   bg: 'bg-[#14b8a6]/15',  bar: 'bg-[#14b8a6]' },
  contacts:      { text: 'text-primary',      bg: 'bg-primary/15',    bar: 'bg-primary' },
  accounts:      { text: 'text-[#8b5cf6]',   bg: 'bg-[#8b5cf6]/15', bar: 'bg-[#8b5cf6]' },
  opportunities: { text: 'text-accent',       bg: 'bg-accent/15',     bar: 'bg-accent' },
  useCases:      { text: 'text-success',      bg: 'bg-success/15',    bar: 'bg-success' },
  activities:    { text: 'text-warning',      bg: 'bg-warning/15',    bar: 'bg-warning' },
  assignments:   { text: 'text-destructive',  bg: 'bg-destructive/15', bar: 'bg-destructive' },
  inbox:         { text: 'text-destructive',  bg: 'bg-destructive/15', bar: 'bg-destructive' },
  hitl:          { text: 'text-destructive',  bg: 'bg-destructive/15', bar: 'bg-destructive' },
  agents:        { text: 'text-[#6366f1]',   bg: 'bg-[#6366f1]/15',  bar: 'bg-[#6366f1]' },
  context:       { text: 'text-[#0ea5e9]',   bg: 'bg-[#0ea5e9]/15',  bar: 'bg-[#0ea5e9]' },
  workflows:     { text: 'text-amber-500',   bg: 'bg-amber-500/15',  bar: 'bg-amber-500' },
  emails:        { text: 'text-[#3b82f6]',   bg: 'bg-[#3b82f6]/15',  bar: 'bg-[#3b82f6]' },
  sequences:     { text: 'text-orange-500',  bg: 'bg-orange-500/15', bar: 'bg-orange-500' },
  auditLog:      { text: 'text-[#a78bfa]',   bg: 'bg-[#a78bfa]/15',  bar: 'bg-[#a78bfa]' },
  operations:    { text: 'text-[#a78bfa]',   bg: 'bg-[#a78bfa]/15',  bar: 'bg-[#a78bfa]' },
} as const;

export const ENTITY_GRADIENTS: Record<string, string> = {
  contacts:      'from-primary to-primary/80',
  accounts:      'from-[#8b5cf6] to-[#8b5cf6]/80',
  opportunities: 'from-accent to-accent/80',
  'use cases':   'from-success to-success/80',
  activities:    'from-warning to-warning/80',
  assignments:   'from-destructive to-destructive/80',
  workflows:     'from-amber-500 to-amber-500/80',
  sequences:     'from-amber-500 to-amber-500/80',
  context:       'from-[#0ea5e9] to-[#0ea5e9]/80',
  emails:        'from-[#3b82f6] to-[#3b82f6]/80',
  actors:        'from-[#6366f1] to-[#6366f1]/80',
};

export const STATUS_TONES = {
  success:     'text-success bg-success/10 border-success/25',
  warning:     'text-warning bg-warning/10 border-warning/30',
  info:        'text-info bg-info/10 border-info/25',
  destructive: 'text-destructive bg-destructive/10 border-destructive/25',
  muted:       'text-muted-foreground bg-muted border-border',
  primary:     'text-primary bg-primary/10 border-primary/25',
} as const;
