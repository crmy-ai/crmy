// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { Badge } from '../../components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/table';
import {
  useApiKeys, useCreateApiKey, useRevokeApiKey,
  useWebhooks, useCreateWebhook, useDeleteWebhook,
  useCustomFields, useCreateCustomField, useDeleteCustomField,
} from '../../api/hooks';
import { getUser } from '../../api/client';

type Tab = 'profile' | 'api-keys' | 'webhooks' | 'custom-fields';

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('profile');

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">Settings</h1>
      <div className="flex gap-2 border-b">
        {(['profile', 'api-keys', 'webhooks', 'custom-fields'] as Tab[]).map((t) => (
          <Button key={t} variant={tab === t ? 'default' : 'ghost'} size="sm" onClick={() => setTab(t)}>
            {t.replace('-', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
          </Button>
        ))}
      </div>
      {tab === 'profile' && <ProfileSection />}
      {tab === 'api-keys' && <ApiKeysSection />}
      {tab === 'webhooks' && <WebhooksSection />}
      {tab === 'custom-fields' && <CustomFieldsSection />}
    </div>
  );
}

function ProfileSection() {
  const user = getUser();
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Profile</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex justify-between"><span className="text-muted-foreground">Name</span><span>{user?.name}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Email</span><span>{user?.email}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Role</span><Badge variant="outline">{user?.role}</Badge></div>
      </CardContent>
    </Card>
  );
}

function ApiKeysSection() {
  const { data } = useApiKeys();
  const create = useCreateApiKey();
  const revoke = useRevokeApiKey();
  const [label, setLabel] = useState('');
  const [newKey, setNewKey] = useState('');

  const keys = (data as any)?.data ?? [];

  const handleCreate = async () => {
    const result = await create.mutateAsync({ label, scopes: ['*'] });
    setNewKey((result as any).key);
    setLabel('');
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">API Keys</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Key label" className="max-w-xs" />
          <Button onClick={handleCreate} disabled={!label || create.isPending}>Create Key</Button>
        </div>
        {newKey && (
          <div className="rounded bg-emerald-50 p-3">
            <p className="text-xs font-medium text-emerald-800 mb-1">New API key (copy now — it won't be shown again):</p>
            <code className="text-xs break-all">{newKey}</code>
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.map((k: any) => (
              <TableRow key={k.id}>
                <TableCell className="font-medium">{k.label}</TableCell>
                <TableCell className="text-muted-foreground">{new Date(k.created_at).toLocaleDateString()}</TableCell>
                <TableCell className="text-muted-foreground">{k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : 'Never'}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => revoke.mutate(k.id)}>Revoke</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function WebhooksSection() {
  const { data } = useWebhooks();
  const create = useCreateWebhook();
  const del = useDeleteWebhook();
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState('*');

  const webhooks = (data as any)?.data ?? [];

  const handleCreate = async () => {
    await create.mutateAsync({ url, event_types: events.split(',').map((e: string) => e.trim()) });
    setUrl('');
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Webhooks</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." className="flex-1" />
          <Input value={events} onChange={(e) => setEvents(e.target.value)} placeholder="Event types" className="w-48" />
          <Button onClick={handleCreate} disabled={!url || create.isPending}>Add</Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>URL</TableHead>
              <TableHead>Events</TableHead>
              <TableHead>Active</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {webhooks.map((w: any) => (
              <TableRow key={w.id}>
                <TableCell className="font-medium truncate max-w-xs">{w.url}</TableCell>
                <TableCell>{(w.event_types ?? w.events ?? []).join(', ')}</TableCell>
                <TableCell><Badge variant={w.is_active ?? w.active ? 'success' : 'secondary'}>{w.is_active ?? w.active ? 'Yes' : 'No'}</Badge></TableCell>
                <TableCell><Button variant="ghost" size="sm" className="text-destructive" onClick={() => del.mutate(w.id)}>Delete</Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function CustomFieldsSection() {
  const [objectType, setObjectType] = useState('contact');
  const { data } = useCustomFields(objectType);
  const create = useCreateCustomField();
  const del = useDeleteCustomField();
  const [fieldName, setFieldName] = useState('');
  const [fieldType, setFieldType] = useState('text');
  const [fieldLabel, setFieldLabel] = useState('');

  const fields = (data as any)?.data ?? [];

  const handleCreate = async () => {
    await create.mutateAsync({
      object_type: objectType,
      field_name: fieldName,
      field_key: fieldName.toLowerCase().replace(/\s+/g, '_'),
      field_type: fieldType,
      label: fieldLabel || fieldName,
    });
    setFieldName('');
    setFieldLabel('');
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Custom Fields</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          {['contact', 'account', 'opportunity', 'activity', 'use_case'].map((t) => (
            <Button key={t} variant={objectType === t ? 'default' : 'outline'} size="sm" onClick={() => setObjectType(t)}>
              {t.replace('_', ' ')}
            </Button>
          ))}
        </div>
        <div className="flex gap-2">
          <Input value={fieldName} onChange={(e) => setFieldName(e.target.value)} placeholder="Field name" />
          <Input value={fieldLabel} onChange={(e) => setFieldLabel(e.target.value)} placeholder="Label" />
          <Select value={fieldType} onChange={(e) => setFieldType(e.target.value)} className="w-32">
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="boolean">Boolean</option>
            <option value="date">Date</option>
            <option value="select">Select</option>
          </Select>
          <Button onClick={handleCreate} disabled={!fieldName || create.isPending}>Add</Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Required</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.map((f: any) => (
              <TableRow key={f.id}>
                <TableCell className="font-medium">{f.field_name ?? f.field_key}</TableCell>
                <TableCell>{f.label}</TableCell>
                <TableCell><Badge variant="outline">{f.field_type}</Badge></TableCell>
                <TableCell>{f.required ?? f.is_required ? 'Yes' : 'No'}</TableCell>
                <TableCell><Button variant="ghost" size="sm" className="text-destructive" onClick={() => del.mutate(f.id)}>Delete</Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
