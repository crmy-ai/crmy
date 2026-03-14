// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Input } from './ui/input';
import { Select } from './ui/select';
import { Badge } from './ui/badge';
import { useCustomFields } from '../api/hooks';

interface CustomFieldDef {
  id: string;
  field_key: string;
  field_name?: string;
  label: string;
  field_type: string;
  options?: string[] | string;
  is_required?: boolean;
  required?: boolean;
}

function parseOptions(options: unknown): string[] {
  if (!options) return [];
  if (Array.isArray(options)) return options.map(String);
  if (typeof options === 'string') {
    try { return JSON.parse(options); } catch { return []; }
  }
  return [];
}

/**
 * Renders dynamic form inputs for custom fields defined on an object type.
 * Integrates into create/edit forms.
 */
export function CustomFieldsForm({
  objectType,
  values,
  onChange,
}: {
  objectType: string;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
}) {
  const { data, isLoading } = useCustomFields(objectType);
  const fields: CustomFieldDef[] = (data as any)?.data ?? (data as any)?.fields ?? [];

  if (isLoading || fields.length === 0) return null;

  const setValue = (key: string, value: unknown) => {
    onChange({ ...values, [key]: value });
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-muted-foreground">Custom Fields</h3>
      {fields.map((field) => {
        const key = field.field_key ?? field.field_name ?? field.id;
        const isRequired = field.is_required ?? field.required ?? false;
        const opts = parseOptions(field.options);

        return (
          <div key={field.id}>
            <label className="mb-1 block text-sm font-medium">
              {field.label}{isRequired ? ' *' : ''}
            </label>
            {renderFieldInput(field.field_type, key, values[key], opts, isRequired, setValue)}
          </div>
        );
      })}
    </div>
  );
}

function renderFieldInput(
  fieldType: string,
  key: string,
  value: unknown,
  options: string[],
  required: boolean,
  setValue: (key: string, value: unknown) => void,
) {
  switch (fieldType) {
    case 'text':
      return (
        <Input
          value={(value as string) ?? ''}
          onChange={(e) => setValue(key, e.target.value)}
          required={required}
        />
      );

    case 'number':
      return (
        <Input
          type="number"
          value={value != null ? String(value) : ''}
          onChange={(e) => setValue(key, e.target.value ? Number(e.target.value) : null)}
          required={required}
        />
      );

    case 'boolean':
      return (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => setValue(key, e.target.checked)}
            className="h-4 w-4 rounded border-input"
          />
          <span className="text-sm">Yes</span>
        </label>
      );

    case 'date':
      return (
        <Input
          type="date"
          value={(value as string) ?? ''}
          onChange={(e) => setValue(key, e.target.value || null)}
          required={required}
        />
      );

    case 'select':
      return (
        <select
          value={(value as string) ?? ''}
          onChange={(e) => setValue(key, e.target.value || null)}
          required={required}
          className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <option value="">Select...</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      );

    case 'multi_select':
      return (
        <MultiSelectInput
          options={options}
          value={Array.isArray(value) ? value as string[] : []}
          onChange={(v) => setValue(key, v)}
        />
      );

    default:
      return (
        <Input
          value={(value as string) ?? ''}
          onChange={(e) => setValue(key, e.target.value)}
        />
      );
  }
}

function MultiSelectInput({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const toggle = (opt: string) => {
    if (value.includes(opt)) {
      onChange(value.filter((v) => v !== opt));
    } else {
      onChange([...value, opt]);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => toggle(opt)}
          className="cursor-pointer"
        >
          <Badge variant={value.includes(opt) ? 'default' : 'outline'}>
            {opt}
          </Badge>
        </button>
      ))}
    </div>
  );
}

/**
 * Displays custom field values on a detail page.
 */
export function CustomFieldsDisplay({
  objectType,
  customFields,
}: {
  objectType: string;
  customFields?: Record<string, unknown>;
}) {
  const { data } = useCustomFields(objectType);
  const defs: CustomFieldDef[] = (data as any)?.data ?? (data as any)?.fields ?? [];

  if (!customFields || Object.keys(customFields).length === 0 || defs.length === 0) return null;

  return (
    <div className="space-y-2">
      {defs.map((def) => {
        const key = def.field_key ?? def.field_name ?? def.id;
        const value = customFields[key];
        if (value === undefined || value === null) return null;

        return (
          <div key={def.id} className="flex justify-between">
            <span className="text-muted-foreground">{def.label}</span>
            <span>{formatFieldValue(def.field_type, value)}</span>
          </div>
        );
      })}
    </div>
  );
}

function formatFieldValue(fieldType: string, value: unknown): string {
  if (value === null || value === undefined) return '—';

  switch (fieldType) {
    case 'boolean':
      return value ? 'Yes' : 'No';
    case 'date':
      return typeof value === 'string' ? new Date(value).toLocaleDateString() : String(value);
    case 'multi_select':
      return Array.isArray(value) ? value.join(', ') : String(value);
    case 'number':
      return typeof value === 'number' ? value.toLocaleString() : String(value);
    default:
      return String(value);
  }
}
