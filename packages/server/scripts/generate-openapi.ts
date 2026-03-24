// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0
// Usage: tsx scripts/generate-openapi.ts
// Writes docs/openapi.json relative to the monorepo root.

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { buildSpec } from '../src/openapi/spec.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..', '..');
const outDir = join(repoRoot, 'docs');
const outFile = join(outDir, 'openapi.json');

const spec = buildSpec();
await mkdir(outDir, { recursive: true });
await writeFile(outFile, JSON.stringify(spec, null, 2) + '\n');

const pathCount = Object.keys(spec.paths ?? {}).length;
const schemaCount = Object.keys(spec.components?.schemas ?? {}).length;
console.log(`✓ docs/openapi.json — ${pathCount} paths, ${schemaCount} component schemas`);
