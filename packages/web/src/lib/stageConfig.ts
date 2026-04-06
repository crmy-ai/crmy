// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

export const stageConfig: Record<string, { label: string; color: string }> = {
  prospecting: { label: 'Prospecting', color: '#94a3b8' },
  qualification: { label: 'Qualification', color: '#60a5fa' },
  proposal: { label: 'Proposal', color: '#a78bfa' },
  negotiation: { label: 'Negotiation', color: '#fb923c' },
  closed_won: { label: 'Won', color: '#4ade80' },
  closed_lost: { label: 'Lost', color: '#f87171' },
  // Contact stages
  lead: { label: 'Lead', color: '#94a3b8' },
  prospect: { label: 'Prospect', color: '#60a5fa' },
  customer: { label: 'Customer', color: '#4ade80' },
  churned: { label: 'Churned', color: '#f87171' },
};

export const useCaseStageConfig: Record<string, { label: string; color: string }> = {
  discovery: { label: 'Discovery', color: '#94a3b8' },
  poc: { label: 'PoC', color: '#60a5fa' },
  production: { label: 'Production', color: '#4ade80' },
  scaling: { label: 'Scaling', color: '#fb923c' },
  sunset: { label: 'Sunset', color: '#f87171' },
};

export const accountStageConfig: Record<string, { label: string; color: string }> = {
  prospect: { label: 'Prospect', color: '#94a3b8' },
  customer: { label: 'Customer', color: '#4ade80' },
  partner: { label: 'Partner', color: '#a78bfa' },
  churned: { label: 'Churned', color: '#f87171' },
};
