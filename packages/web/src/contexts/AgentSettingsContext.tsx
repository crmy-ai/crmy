// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAgentConfig, type AgentConfigData } from '@/api/hooks';

export type AgentConnectivity = 'unknown' | 'online' | 'offline';

export interface AgentSettings {
  /** Whether the agent is enabled for this tenant. */
  enabled: boolean;
  /** Full config object (null if never configured). */
  config: AgentConfigData | null;
  /** True while the config is being fetched. */
  loading: boolean;
  /**
   * Whether the LLM endpoint is reachable.
   * 'unknown' = not yet probed (e.g. agent not enabled).
   * 'online'  = last probe succeeded.
   * 'offline' = last probe failed.
   */
  connectivity: AgentConnectivity;
}

const AgentSettingsContext = createContext<AgentSettings>({
  enabled: false,
  config: null,
  loading: true,
  connectivity: 'unknown',
});

const PROBE_INTERVAL_MS = 5 * 60 * 1000; // re-probe every 5 minutes
const PROBE_ENDPOINT = '/api/v1/agent/config/test';

export function AgentSettingsProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useAgentConfig();
  const config = data?.data ?? null;
  const enabled = config?.enabled ?? false;

  const [connectivity, setConnectivity] = useState<AgentConnectivity>('unknown');
  const lastProbeRef = useRef<number>(0);

  useEffect(() => {
    // Only probe when the agent is enabled and configured
    if (!enabled || !config?.model || !config?.base_url) {
      setConnectivity('unknown');
      return;
    }

    const probe = async () => {
      const token = localStorage.getItem('crmy_token');
      try {
        const res = await fetch(PROBE_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          // Send empty body — the endpoint will use stored config values
          body: JSON.stringify({}),
        });
        if (res.ok) {
          const json = await res.json();
          setConnectivity(json.ok ? 'online' : 'offline');
        } else {
          setConnectivity('offline');
        }
      } catch {
        setConnectivity('offline');
      }
      lastProbeRef.current = Date.now();
    };

    // Probe immediately on mount / config change, then on interval
    probe();
    const timer = setInterval(() => probe(), PROBE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [enabled, config?.model, config?.base_url, config?.provider]);

  return (
    <AgentSettingsContext.Provider value={{ enabled, config, loading: isLoading, connectivity }}>
      {children}
    </AgentSettingsContext.Provider>
  );
}

export function useAgentSettings() {
  return useContext(AgentSettingsContext);
}
