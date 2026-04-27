// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useSearchParams, Link } from 'react-router-dom';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { useSearch } from '../api/hooks';

export function SearchResultsPage() {
  const [searchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const { data, isLoading } = useSearch(q);

  const results = (data as any)?.data ?? (data as any)?.results ?? [];

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">Search: "{q}"</h1>
      {isLoading ? (
        <p className="text-muted-foreground">Searching...</p>
      ) : results.length === 0 ? (
        <p className="text-muted-foreground">No results found</p>
      ) : (
        <div className="space-y-2">
          {results.map((r: any) => {
            const type = r.object_type ?? r.type ?? 'unknown';
            const href =
              type === 'contact' ? `/app/contacts/${r.id}`
              : type === 'account' ? `/app/companies/${r.id}`
              : type === 'opportunity' ? `/app/opportunities/${r.id}`
              : type === 'use_case' ? `/app/use-cases/${r.id}`
              : '#';
            return (
              <Link key={`${type}-${r.id}`} to={href}>
                <Card className="hover:bg-accent transition-colors cursor-pointer">
                  <CardContent className="flex items-center gap-3 p-4">
                    <Badge variant="outline">{type}</Badge>
                    <span className="font-medium">{r.name ?? r.first_name ? `${r.first_name ?? ''} ${r.last_name ?? ''}` : r.id}</span>
                    {r.email && <span className="text-sm text-muted-foreground">{r.email}</span>}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
