// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  useAccounts,
  useAccount,
  useContacts,
  useContact,
  useOpportunities,
  useOpportunity,
  useUseCases,
  useUseCase,
} from '@/api/hooks';
import { useDebounce } from '@/hooks/useDebounce';

export type EntityType = 'account' | 'contact' | 'opportunity' | 'use_case';

interface EntityComboboxProps {
  entityType: EntityType;
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  clearable?: boolean;
  disabled?: boolean;
  className?: string;
}

/** Returns a short human-readable label for a raw entity row. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getLabel(entityType: EntityType, item: any): string {
  if (entityType === 'contact') {
    const name = [item.first_name, item.last_name].filter(Boolean).join(' ');
    return name || item.email || item.id;
  }
  if (entityType === 'account') return item.name ?? item.id;
  if (entityType === 'opportunity') {
    const amt = item.amount ? ` · $${Number(item.amount) >= 1000 ? `${(Number(item.amount) / 1000).toFixed(0)}K` : item.amount}` : '';
    return (item.name ?? item.id) + amt;
  }
  if (entityType === 'use_case') return item.name ?? item.id;
  return item.id;
}

/** Fetches the display label for the currently-selected value. */
function useSelectedLabel(entityType: EntityType, id: string): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: accData } = useAccount(entityType === 'account' ? id : '') as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: conData } = useContact(entityType === 'contact' ? id : '') as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: oppData } = useOpportunity(entityType === 'opportunity' ? id : '') as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ucData } = useUseCase(entityType === 'use_case' ? id : '') as any;

  if (!id) return undefined;
  if (entityType === 'account' && accData?.account) return getLabel('account', accData.account);
  if (entityType === 'contact' && conData?.contact) return getLabel('contact', conData.contact);
  if (entityType === 'opportunity' && oppData?.opportunity) return getLabel('opportunity', oppData.opportunity);
  if (entityType === 'use_case' && ucData?.use_case) return getLabel('use_case', ucData.use_case);
  return undefined;
}

/** Search results hook — only fires when the combobox is open. */
function useSearchResults(entityType: EntityType, q: string, enabled: boolean) {
  const params = enabled ? { q: q || undefined, limit: 10 } : undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: accData } = useAccounts(entityType === 'account' ? params : undefined) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: conData } = useContacts(entityType === 'contact' ? params : undefined) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: oppData } = useOpportunities(entityType === 'opportunity' ? params : undefined) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ucData } = useUseCases(entityType === 'use_case' ? params : undefined) as any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let raw: any[] = [];
  if (entityType === 'account') raw = accData?.data ?? accData?.accounts ?? [];
  else if (entityType === 'contact') raw = conData?.data ?? conData?.contacts ?? [];
  else if (entityType === 'opportunity') raw = oppData?.data ?? oppData?.opportunities ?? [];
  else if (entityType === 'use_case') raw = ucData?.data ?? ucData?.use_cases ?? [];

  return raw.map(item => ({ id: item.id as string, label: getLabel(entityType, item) }));
}

export function EntityCombobox({
  entityType,
  value,
  onChange,
  placeholder,
  clearable = true,
  disabled = false,
  className,
}: EntityComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const debouncedQ = useDebounce(query, 300);

  const selectedLabel = useSelectedLabel(entityType, value);
  const results = useSearchResults(entityType, debouncedQ, open);

  const defaultPlaceholder = `Select ${entityType.replace('_', ' ')}…`;
  const triggerLabel = value ? (selectedLabel ?? '…') : (placeholder ?? defaultPlaceholder);
  const hasValue = !!value;

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery('');
  };

  const handleSelect = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery('');
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'w-full h-10 px-3 rounded-md border border-border bg-background text-sm outline-none',
            'flex items-center justify-between gap-2',
            'hover:border-ring focus:ring-1 focus:ring-ring transition-colors',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            className,
          )}
        >
          <span className={cn('flex-1 text-left truncate', !hasValue && 'text-muted-foreground')}>
            {triggerLabel}
          </span>
          <span className="flex items-center gap-1 shrink-0">
            {clearable && hasValue && (
              <X
                className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground transition-colors"
                onClick={handleClear}
              />
            )}
            <ChevronsUpDown className="w-3.5 h-3.5 text-muted-foreground opacity-60" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0 w-[--radix-popover-trigger-width] min-w-[200px]"
        align="start"
        sideOffset={4}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={`Search ${entityType.replace('_', ' ')}s…`}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty className="py-4 text-center text-sm text-muted-foreground">
              {debouncedQ ? 'No results found.' : 'Start typing to search…'}
            </CommandEmpty>
            <CommandGroup>
              {results.map(item => (
                <CommandItem
                  key={item.id}
                  value={item.id}
                  onSelect={() => handleSelect(item.id)}
                  className="flex items-center gap-2"
                >
                  <Check
                    className={cn('w-3.5 h-3.5 shrink-0', value === item.id ? 'opacity-100' : 'opacity-0')}
                  />
                  <span className="truncate">{item.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
