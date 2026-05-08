// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

export function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

export function headerDescription(description: string, count: number, singular: string, plural?: string) {
  return `${description} • ${countLabel(count, singular, plural)}`;
}
