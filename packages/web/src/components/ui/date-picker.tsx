// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import * as React from 'react';
import { format, parse, isValid, isAfter, isBefore } from 'date-fns';
import { CalendarIcon, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// ─── DatePicker ───────────────────────────────────────────────────────────────

export interface DatePickerProps {
  /** Controlled value as "YYYY-MM-DD" string, or "" for empty */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** When true the clear button is hidden and clearing is not allowed */
  required?: boolean;
  /** Reject and disable dates before this date */
  minDate?: Date;
  /** Reject and disable dates after this date */
  maxDate?: Date;
  /**
   * "default" = h-10, matches the inputClass used in drawer edit forms.
   * "sm"      = h-8,  matches the filter bar compact inputs.
   */
  size?: 'default' | 'sm';
  /** Extra classes applied to the trigger button (e.g. "w-36" to constrain width) */
  className?: string;
}

export function DatePicker({
  value,
  onChange,
  placeholder = 'Pick a date',
  disabled = false,
  required = false,
  minDate,
  maxDate,
  size = 'default',
  className,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);

  const selectedDate = React.useMemo<Date | undefined>(() => {
    if (!value) return undefined;
    const d = parse(value, 'yyyy-MM-dd', new Date());
    return isValid(d) ? d : undefined;
  }, [value]);

  const isDayDisabled = React.useCallback(
    (day: Date) => {
      if (minDate && isBefore(day, minDate)) return true;
      if (maxDate && isAfter(day, maxDate)) return true;
      return false;
    },
    [minDate, maxDate],
  );

  const handleSelect = (day: Date | undefined) => {
    onChange(day ? format(day, 'yyyy-MM-dd') : '');
    setOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
  };

  const sm = size === 'sm';

  return (
    <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-required={required}
          disabled={disabled}
          className={cn(
            'inline-flex w-full items-center gap-2 rounded-md border border-border bg-background',
            'text-foreground outline-none transition-colors',
            'hover:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
            sm ? 'h-8 px-2 text-xs' : 'h-10 px-3 text-sm',
            className,
          )}
        >
          <CalendarIcon
            className={cn(
              'shrink-0 text-muted-foreground',
              sm ? 'h-3.5 w-3.5' : 'h-4 w-4',
            )}
          />
          <span className={cn('flex-1 text-left', !selectedDate && 'text-muted-foreground')}>
            {selectedDate ? format(selectedDate, 'MMM d, yyyy') : placeholder}
          </span>
          {selectedDate && !required && (
            <X
              onClick={handleClear}
              aria-label="Clear date"
              className={cn(
                'shrink-0 text-muted-foreground hover:text-foreground',
                sm ? 'h-3 w-3' : 'h-3.5 w-3.5',
              )}
            />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 rounded-xl shadow-xl" align="start">
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={handleSelect}
          disabled={isDayDisabled}
          showOutsideDays={false}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}

// ─── DateTimePicker ───────────────────────────────────────────────────────────

export interface DateTimePickerProps {
  /**
   * Controlled value as a local ISO-like string "YYYY-MM-DDTHH:mm:ss" or "".
   * Compatible with new Date(value).toISOString() conversion in submit handlers.
   */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  minDate?: Date;
  maxDate?: Date;
  size?: 'default' | 'sm';
  className?: string;
}

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1); // 1–12
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

export function DateTimePicker({
  value,
  onChange,
  placeholder = 'Pick date & time',
  disabled = false,
  required = false,
  minDate,
  maxDate,
  size = 'default',
  className,
}: DateTimePickerProps) {
  const [open, setOpen] = React.useState(false);

  const selectedDate = React.useMemo<Date | undefined>(() => {
    if (!value) return undefined;
    const d = new Date(value);
    return isValid(d) ? d : undefined;
  }, [value]);

  const emit = (date: Date) => {
    onChange(format(date, "yyyy-MM-dd'T'HH:mm:00"));
  };

  // Derived 12-hour time parts (safe defaults when no date selected yet)
  const rawHour = selectedDate?.getHours() ?? 12;
  const hour12 = rawHour % 12 || 12;
  const minute = selectedDate?.getMinutes() ?? 0;
  const ampm: 'AM' | 'PM' = rawHour >= 12 ? 'PM' : 'AM';

  const handleDaySelect = (day: Date | undefined) => {
    if (!day) { onChange(''); return; }
    const base = selectedDate ? new Date(selectedDate) : new Date();
    base.setFullYear(day.getFullYear(), day.getMonth(), day.getDate());
    if (!selectedDate) base.setHours(12, 0, 0, 0); // default to noon on first pick
    emit(base);
    // Don't close — user still needs to pick time
  };

  const handleTimeChange = (part: 'hour' | 'minute' | 'ampm', val: string) => {
    const base = selectedDate
      ? new Date(selectedDate)
      : (() => { const d = new Date(); d.setSeconds(0, 0); return d; })();

    if (part === 'hour') {
      const h12 = parseInt(val, 10);
      base.setHours(ampm === 'PM' ? (h12 === 12 ? 12 : h12 + 12) : (h12 === 12 ? 0 : h12));
    } else if (part === 'minute') {
      base.setMinutes(parseInt(val, 10));
    } else {
      const h = base.getHours();
      if (val === 'AM' && h >= 12) base.setHours(h - 12);
      if (val === 'PM' && h < 12) base.setHours(h + 12);
    }
    emit(base);
  };

  const isDayDisabled = React.useCallback(
    (day: Date) => {
      if (minDate && isBefore(day, minDate)) return true;
      if (maxDate && isAfter(day, maxDate)) return true;
      return false;
    },
    [minDate, maxDate],
  );

  const displayValue = selectedDate
    ? format(selectedDate, "MMM d, yyyy 'at' h:mm a")
    : null;

  const sm = size === 'sm';
  const selectCls =
    'h-8 rounded-md border border-border bg-background text-foreground text-xs px-1.5 outline-none focus:ring-1 focus:ring-ring';

  return (
    <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-required={required}
          disabled={disabled}
          className={cn(
            'inline-flex w-full items-center gap-2 rounded-md border border-border bg-background',
            'text-foreground outline-none transition-colors',
            'hover:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
            sm ? 'h-8 px-2 text-xs' : 'h-10 px-3 text-sm',
            className,
          )}
        >
          <CalendarIcon
            className={cn(
              'shrink-0 text-muted-foreground',
              sm ? 'h-3.5 w-3.5' : 'h-4 w-4',
            )}
          />
          <span className={cn('flex-1 text-left', !selectedDate && 'text-muted-foreground')}>
            {displayValue ?? placeholder}
          </span>
          {selectedDate && !required && (
            <X
              onClick={(e) => { e.stopPropagation(); onChange(''); }}
              aria-label="Clear date and time"
              className={cn(
                'shrink-0 text-muted-foreground hover:text-foreground',
                sm ? 'h-3 w-3' : 'h-3.5 w-3.5',
              )}
            />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 rounded-xl shadow-xl" align="start">
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={handleDaySelect}
          disabled={isDayDisabled}
          showOutsideDays={false}
          initialFocus
        />
        {/* Time selector */}
        <div className="flex items-center gap-2 border-t border-border p-3">
          <span className="mr-1 font-mono text-xs text-muted-foreground">Time</span>
          <select
            value={hour12}
            onChange={(e) => handleTimeChange('hour', e.target.value)}
            className={selectCls}
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, '0')}
              </option>
            ))}
          </select>
          <span className="select-none text-sm text-muted-foreground">:</span>
          <select
            value={minute}
            onChange={(e) => handleTimeChange('minute', e.target.value)}
            className={selectCls}
          >
            {MINUTES.map((m) => (
              <option key={m} value={m}>
                {String(m).padStart(2, '0')}
              </option>
            ))}
          </select>
          <select
            value={ampm}
            onChange={(e) => handleTimeChange('ampm', e.target.value)}
            className={selectCls}
          >
            <option value="AM">AM</option>
            <option value="PM">PM</option>
          </select>
        </div>
        <div className="px-3 pb-3">
          <Button size="sm" className="w-full" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
