// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Plus, X } from 'lucide-react';
import {
  FILTER_OPERATORS, type FilterCondition, type FilterOperator,
} from '@/lib/workflowConstants';

interface Props {
  conditions: FilterCondition[];
  onChange: (conditions: FilterCondition[]) => void;
  disabled?: boolean;
}

const inputCls = 'h-7 px-2 rounded border border-border bg-background text-xs text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring';
const selectCls = 'h-7 px-1.5 rounded border border-border bg-background text-xs text-foreground outline-none focus:ring-1 focus:ring-ring cursor-pointer';

export function WorkflowFilterBuilder({ conditions, onChange, disabled }: Props) {
  function addCondition() {
    onChange([...conditions, { field: '', op: 'eq', value: '' }]);
  }

  function updateCondition(idx: number, patch: Partial<FilterCondition>) {
    onChange(conditions.map((c, i) => i === idx ? { ...c, ...patch } : c));
  }

  function removeCondition(idx: number) {
    onChange(conditions.filter((_, i) => i !== idx));
  }

  const noValueOps: FilterOperator[] = ['exists', 'not_exists'];

  return (
    <div className="space-y-2">
      {conditions.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          No conditions — workflow runs for all matching events
        </p>
      ) : (
        <div className="space-y-1.5">
          {conditions.map((cond, idx) => (
            <div key={idx} className="flex items-center gap-1.5 flex-wrap">
              <input
                value={cond.field}
                onChange={e => updateCondition(idx, { field: e.target.value })}
                placeholder="Field name"
                disabled={disabled}
                className={`${inputCls} w-32`}
              />
              <select
                value={cond.op}
                onChange={e => updateCondition(idx, { op: e.target.value as FilterOperator })}
                disabled={disabled}
                className={`${selectCls} w-32`}
              >
                {FILTER_OPERATORS.map(op => (
                  <option key={op.value} value={op.value}>{op.label}</option>
                ))}
              </select>
              {!noValueOps.includes(cond.op) && (
                <input
                  value={cond.value}
                  onChange={e => updateCondition(idx, { value: e.target.value })}
                  placeholder="Value"
                  disabled={disabled}
                  className={`${inputCls} flex-1 min-w-[80px]`}
                />
              )}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeCondition(idx)}
                  className="flex-shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Human-readable preview */}
      {conditions.filter(c => c.field).length > 0 && (
        <p className="text-xs text-muted-foreground italic">
          Only runs when{' '}
          {conditions
            .filter(c => c.field)
            .map(c => {
              const opLabel = FILTER_OPERATORS.find(o => o.value === c.op)?.label ?? c.op;
              if (noValueOps.includes(c.op)) return `${c.field} ${opLabel}`;
              return `${c.field} ${opLabel} "${c.value}"`;
            })
            .join(' AND ')}
        </p>
      )}

      {!disabled && (
        <button
          type="button"
          onClick={addCondition}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add condition
        </button>
      )}
    </div>
  );
}
