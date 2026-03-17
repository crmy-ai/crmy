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
  assignments:   { text: 'text-destructive',  bg: 'bg-destructive/15',bar: 'bg-destructive' },
  inbox:         { text: 'text-destructive',  bg: 'bg-destructive/15',bar: 'bg-destructive' },
} as const;
