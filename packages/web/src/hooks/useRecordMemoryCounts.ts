// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useMemo } from 'react';
import { useContextEntries } from '@/api/hooks';

type MemorySubjectType = 'account' | 'contact' | 'opportunity' | 'use_case';

export function useRecordMemoryCounts(subjectType: MemorySubjectType) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = useContextEntries({ subject_type: subjectType, memory_status: 'active', is_current: true, limit: 500 }) as any;

  return useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of data?.data ?? []) {
      if (!entry.subject_id) continue;
      counts.set(entry.subject_id as string, (counts.get(entry.subject_id as string) ?? 0) + 1);
    }
    return counts;
  }, [data]);
}
