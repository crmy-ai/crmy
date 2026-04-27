// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { AlertTriangle, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';

export interface DuplicateCandidate {
  id: string;
  name: string;
  score: number;
  reasons: string[];
}

interface Props {
  entityType: 'contact' | 'account' | 'opportunity' | 'use-case';
  candidates: DuplicateCandidate[];
  onUseExisting: (id: string) => void;
  onCreateAnyway: () => void;
  onCancel: () => void;
}

const entityLabels: Record<Props['entityType'], string> = {
  contact: 'contact',
  account: 'account',
  opportunity: 'opportunity',
  'use-case': 'use case',
};

const confidenceLabel = (score: number): { label: string; className: string } => {
  if (score >= 90) return { label: 'Definitive match', className: 'text-destructive' };
  if (score >= 70) return { label: 'Likely match', className: 'text-amber-500' };
  return { label: 'Possible match', className: 'text-muted-foreground' };
};

export function DuplicateWarning({ entityType, candidates, onUseExisting, onCreateAnyway, onCancel }: Props) {
  const label = entityLabels[entityType];
  const topScore = candidates[0]?.score ?? 0;
  const isDefinitive = topScore >= 90;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-3"
    >
      {/* Header */}
      <div className="flex items-start gap-2.5">
        <div className={`mt-0.5 p-1.5 rounded-lg ${isDefinitive ? 'bg-destructive/10' : 'bg-amber-500/10'}`}>
          <AlertTriangle className={`w-4 h-4 ${isDefinitive ? 'text-destructive' : 'text-amber-500'}`} />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">
            {isDefinitive ? 'Duplicate detected' : `Possible duplicate${candidates.length > 1 ? 's' : ''} found`}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isDefinitive
              ? `A ${label} with this information already exists.`
              : `We found ${candidates.length === 1 ? 'a record' : `${candidates.length} records`} that may match what you're creating.`}
          </p>
        </div>
      </div>

      {/* Candidates */}
      <div className="space-y-2">
        {candidates.map((c) => {
          const conf = confidenceLabel(c.score);
          return (
            <div
              key={c.id}
              className="group flex items-center gap-3 p-2.5 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{c.name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`text-xs ${conf.className}`}>{conf.label}</span>
                  <span className="text-muted-foreground/40 text-xs">·</span>
                  <span className="text-xs text-muted-foreground truncate">
                    {c.reasons.join(', ')}
                  </span>
                </div>
              </div>
              <button
                onClick={() => onUseExisting(c.id)}
                className="flex items-center gap-1 text-xs text-primary font-medium hover:underline shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                Use this <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={onCancel}
          className="flex-1 py-2 rounded-xl border border-border text-xs text-muted-foreground hover:bg-muted transition-colors"
        >
          Cancel
        </button>
        {!isDefinitive && (
          <button
            onClick={onCreateAnyway}
            className="flex-1 py-2 rounded-xl bg-muted border border-border text-xs text-foreground font-medium hover:bg-muted/80 transition-colors"
          >
            Create anyway
          </button>
        )}
        {candidates.length === 1 && (
          <button
            onClick={() => onUseExisting(candidates[0].id)}
            className="flex-1 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
          >
            Use existing
          </button>
        )}
      </div>
    </motion.div>
  );
}
