// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import {
  PRECERTIFIED_MODEL_REGISTRY,
  PROVIDERS,
} from '@crmy/shared';
import { providerModelsFromCatalog } from '../model-catalog.js';

export function installerMetadataCommand(): Command {
  const command = new Command('_installer-metadata')
    .description('Print internal installer metadata')
    .option('--json', 'Print machine-readable JSON', true)
    .action(() => {
      const payload = {
        schema_version: 1,
        providers: PROVIDERS.map(provider => ({
          ...provider,
          models: providerModelsFromCatalog(provider.id),
          needsCustomBaseUrl:
            provider.id === 'custom'
            || provider.baseUrl.includes('YOUR-')
            || provider.baseUrl.trim().length === 0,
        })),
        precertified_models: PRECERTIFIED_MODEL_REGISTRY,
      };
      console.log(JSON.stringify(payload, null, 2));
    });
  (command as Command & { _hidden: boolean })._hidden = true;
  return command;
}
