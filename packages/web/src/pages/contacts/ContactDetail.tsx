// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useParams, Link } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { useContact } from '../../api/hooks';
import { CustomFieldsDisplay } from '../../components/CustomFields';

export function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useContact(id!);
  const contact = (data as any)?.data ?? data;

  if (isLoading) return <p className="text-muted-foreground">Loading...</p>;
  if (!contact) return <p className="text-muted-foreground">Contact not found</p>;

  const activities = contact.activities ?? [];
  const useCases = contact.use_cases ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">{contact.first_name} {contact.last_name}</h1>
          <p className="text-muted-foreground">{contact.title}{contact.company_name ? ` at ${contact.company_name}` : ''}</p>
        </div>
        <Badge variant="outline">{contact.lifecycle_stage}</Badge>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Email</span><span>{contact.email ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Phone</span><span>{contact.phone ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Source</span><span>{contact.source ?? '—'}</span></div>
            {contact.account_id && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Account</span>
                <Link to={`/app/accounts/${contact.account_id}`} className="text-primary hover:underline">View</Link>
              </div>
            )}
            {contact.tags?.length > 0 && (
              <div className="flex gap-1 pt-2">
                {contact.tags.map((t: string) => <Badge key={t} variant="secondary">{t}</Badge>)}
              </div>
            )}
            <CustomFieldsDisplay objectType="contact" customFields={contact.custom_fields} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Recent Activity</CardTitle></CardHeader>
          <CardContent>
            {activities.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activities yet</p>
            ) : (
              <div className="space-y-2">
                {activities.slice(0, 10).map((a: any) => (
                  <div key={a.id} className="flex items-center gap-2 text-sm border-b pb-2">
                    <Badge variant="outline">{a.type}</Badge>
                    <span className="truncate">{a.subject}</span>
                    <time className="ml-auto text-xs text-muted-foreground">{new Date(a.created_at).toLocaleDateString()}</time>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {useCases.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Use Cases</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {useCases.map((uc: any) => (
                <div key={uc.id} className="flex items-center gap-3 text-sm border-b pb-2">
                  <Link to={`/app/use-cases/${uc.id}`} className="font-medium text-primary hover:underline">{uc.name}</Link>
                  <Badge className="text-xs" variant="outline">{uc.stage}</Badge>
                  {uc.role && <Badge variant="secondary">{uc.role}</Badge>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
