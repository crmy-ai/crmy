// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { PROVIDERS, getProvider, isProviderId } from '@crmy/shared';
import {
  builtInModelCatalogEntries,
  mergeModelCatalogEntries,
  mergedCachedModelCatalog,
  modelCatalogCachePath,
  readModelCatalogCache,
  refreshOllamaModels,
  refreshOpenRouterModels,
  writeModelCatalogCache,
  type ModelCatalogEntry,
} from '../model-catalog.js';

function asJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function formatSource(entry: ModelCatalogEntry): string {
  if (entry.source === 'built_in') return 'built-in';
  return entry.fetched_at ? `${entry.source} ${entry.fetched_at.slice(0, 10)}` : entry.source;
}

function filterEntries(entries: ModelCatalogEntry[], opts: { provider?: string; certifiedOnly?: boolean; source?: string }): ModelCatalogEntry[] {
  return entries.filter(entry => {
    if (opts.provider && entry.provider !== opts.provider) return false;
    if (opts.certifiedOnly && entry.certification_status !== 'certified') return false;
    if (opts.source && entry.source !== opts.source) return false;
    return true;
  });
}

function statusLabel(entry: ModelCatalogEntry): string {
  return entry.certification_status === 'certified'
    ? `certified ${entry.certification_score != null ? Math.round(entry.certification_score * 100) + '%' : ''}`.trim()
    : 'review-only';
}

function truncate(value: string, width: number): string {
  if (value.length <= width) return value;
  if (width <= 1) return value.slice(0, width);
  return `${value.slice(0, width - 1)}…`;
}

function pad(value: string, width: number): string {
  return truncate(value, width).padEnd(width, ' ');
}

function printCompactEntries(entries: ModelCatalogEntry[]): void {
  if (entries.length === 0) {
    console.log('No models found.');
    return;
  }

  const providerWidth = Math.min(
    Math.max('Provider'.length, ...entries.map(entry => entry.provider.length)),
    16,
  );
  const statusWidth = Math.max('Status'.length, ...entries.map(entry => statusLabel(entry).length));
  const sourceWidth = Math.max('Source'.length, ...entries.map(entry => formatSource(entry).length));
  const modelWidth = Math.min(
    Math.max('Model'.length, ...entries.map(entry => entry.model.length)),
    42,
  );

  console.log([
    pad('Provider', providerWidth),
    pad('Model', modelWidth),
    pad('Status', statusWidth),
    pad('Source', sourceWidth),
  ].join('  '));
  console.log([
    '-'.repeat(providerWidth),
    '-'.repeat(modelWidth),
    '-'.repeat(statusWidth),
    '-'.repeat(sourceWidth),
  ].join('  '));

  for (const entry of entries) {
    console.log([
      pad(entry.provider, providerWidth),
      pad(entry.model, modelWidth),
      pad(statusLabel(entry), statusWidth),
      pad(formatSource(entry), sourceWidth),
    ].join('  '));
  }
  console.log(`\n${entries.length} model${entries.length === 1 ? '' : 's'}. Use --verbose for labels, descriptions, and context metadata.`);
}

function printVerboseEntries(entries: ModelCatalogEntry[]): void {
  if (entries.length === 0) {
    console.log('No models found.');
    return;
  }
  for (const entry of entries) {
    console.log(`${entry.provider}/${entry.model}`);
    console.log(`  ${entry.label}`);
    console.log(`  ${statusLabel(entry)} | ${formatSource(entry)}`);
    if (entry.context_window) console.log(`  context: ${entry.context_window.toLocaleString()} tokens`);
    if (entry.description) console.log(`  ${entry.description}`);
  }
}

async function refreshProviders(providers: string[], includeBuiltIn: boolean): Promise<{ entries: ModelCatalogEntry[]; errors: Array<{ provider: string; error: string }> }> {
  const refreshed: ModelCatalogEntry[] = [];
  const errors: Array<{ provider: string; error: string }> = [];
  for (const provider of providers) {
    try {
      if (provider === 'openrouter') {
        refreshed.push(...await refreshOpenRouterModels());
      } else if (provider === 'ollama') {
        refreshed.push(...await refreshOllamaModels());
      } else if (provider === 'built_in') {
        refreshed.push(...builtInModelCatalogEntries());
      } else {
        throw new Error(`Dynamic refresh is not implemented for provider '${provider}'. Supported: openrouter, ollama.`);
      }
    } catch (err) {
      errors.push({ provider, error: err instanceof Error ? err.message : String(err) });
    }
  }
  if (refreshed.length === 0 && errors.length > 0) {
    throw new Error(errors.map(error => `${error.provider}: ${error.error}`).join('; '));
  }
  const base = includeBuiltIn ? builtInModelCatalogEntries() : [];
  return { entries: mergeModelCatalogEntries(base, refreshed), errors };
}

export function modelsCommand(): Command {
  const cmd = new Command('models')
    .description('List, refresh, and inspect the Workspace Agent model catalog');

  cmd.command('list')
    .description('List models from the built-in catalog plus cached provider discovery')
    .option('--provider <id>', 'Filter by provider')
    .option('--source <source>', 'Filter by source: built_in, openrouter, ollama, local_override')
    .option('--certified-only', 'Show only CRMy-certified models')
    .option('--verbose', 'Show labels, descriptions, and context metadata')
    .option('--json', 'Print raw JSON')
    .action((opts) => {
      const entries = filterEntries(mergedCachedModelCatalog(), {
        provider: opts.provider,
        source: opts.source,
        certifiedOnly: !!opts.certifiedOnly,
      });
      if (opts.json) {
        asJson({ entries });
      } else {
        opts.verbose ? printVerboseEntries(entries) : printCompactEntries(entries);
      }
    });

  cmd.command('refresh')
    .description('Refresh dynamic model metadata into ~/.crmy/model-catalog.json')
    .option('--provider <id>', 'Provider to refresh: openrouter, ollama, or all dynamic providers', 'all')
    .option('--no-built-in', 'Do not merge built-in models into the written cache')
    .option('--json', 'Print raw JSON')
    .action(async (opts) => {
      const providers = opts.provider === 'all'
        ? ['openrouter', 'ollama']
        : [String(opts.provider)];
      const { entries, errors } = await refreshProviders(providers, opts.builtIn !== false);
      const cache = writeModelCatalogCache(entries);
      if (opts.json) {
        asJson({ ...cache, errors });
      } else {
        console.log(`Refreshed ${cache.entries.length} model entries.`);
        console.log(`Cache: ${modelCatalogCachePath()}`);
        for (const error of errors) {
          console.warn(`Skipped ${error.provider}: ${error.error}`);
        }
        console.log('Discovered models are selectable, but automatic Memory still requires CRMy certification or `crmy certify --output ./eval-runs`.');
      }
    });

  cmd.command('status')
    .description('Show catalog cache and provider discovery status')
    .option('--json', 'Print raw JSON')
    .action((opts) => {
      const cache = readModelCatalogCache();
      const entries = mergedCachedModelCatalog();
      const dynamicEntries = entries.filter(entry => entry.source !== 'built_in');
      const payload = {
        cache_path: modelCatalogCachePath(),
        cache_fetched_at: cache?.fetched_at ?? null,
        built_in_models: builtInModelCatalogEntries().length,
        cached_dynamic_models: dynamicEntries.length,
        providers: PROVIDERS.map(provider => ({
          id: provider.id,
          label: provider.label,
          built_in_models: provider.models.length,
          cached_models: entries.filter(entry => entry.provider === provider.id).length,
          dynamic_refresh: provider.id === 'openrouter' || provider.id === 'ollama',
        })),
      };
      if (opts.json) asJson(payload);
      else {
        console.log(`Cache: ${payload.cache_path}`);
        console.log(`Last refresh: ${payload.cache_fetched_at ?? 'never'}`);
        console.log(`Built-in models: ${payload.built_in_models}`);
        console.log(`Cached dynamic models: ${payload.cached_dynamic_models}`);
        for (const provider of payload.providers) {
          const dynamic = provider.dynamic_refresh ? 'refreshable' : 'static/custom';
          console.log(`- ${provider.id}: ${provider.cached_models} total (${dynamic})`);
        }
      }
    });

  cmd.command('probe <provider> <model>')
    .description('Inspect catalog/provenance for a model without certifying it')
    .option('--base-url <url>', 'Provider base URL override')
    .option('--json', 'Print raw JSON')
    .action((provider, model, opts) => {
      const providerDef = getProvider(provider);
      const baseUrl = opts.baseUrl ?? providerDef.baseUrl;
      const entries = mergedCachedModelCatalog();
      const entry = entries.find(item =>
        item.provider === provider
        && item.model === model
        && item.base_url.replace(/\/+$/, '') === String(baseUrl).replace(/\/+$/, ''),
      ) ?? {
        provider,
        provider_label: isProviderId(provider) ? providerDef.label : provider,
        base_url: baseUrl,
        model,
        label: model,
        source: 'local_override' as const,
        certification_status: 'uncertified' as const,
      };
      const payload = {
        ...entry,
        automatic_memory: entry.certification_status === 'certified' ? 'enabled' : 'review_only_until_certified',
        next_step: entry.certification_status === 'certified'
          ? 'Use this exact provider/base URL/model to keep automatic Memory enabled.'
          : 'Run `crmy certify --output ./eval-runs` after configuring this exact model to enable automatic Memory.',
      };
      if (opts.json) asJson(payload);
      else {
        printVerboseEntries([entry]);
        console.log(`  automatic_memory: ${payload.automatic_memory}`);
        console.log(`  next: ${payload.next_step}`);
      }
    });

  cmd.command('recommend')
    .description('Show recommended starting models')
    .option('--certified-only', 'Only show CRMy-certified recommendations', true)
    .option('--verbose', 'Show labels, descriptions, and context metadata')
    .option('--json', 'Print raw JSON')
    .action((opts) => {
      const entries = mergedCachedModelCatalog();
      const recommended = entries.filter(entry =>
        opts.certifiedOnly !== false
          ? entry.certification_status === 'certified'
          : entry.source === 'built_in',
      );
      if (opts.json) asJson({ entries: recommended });
      else opts.verbose ? printVerboseEntries(recommended) : printCompactEntries(recommended);
    });

  return cmd;
}
