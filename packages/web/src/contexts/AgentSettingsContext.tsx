// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import React, { createContext, useContext } from 'react';
import { useAgentConfig, type AgentConfigData } from '@/api/hooks';

export interface AgentSettings {
  /** Whether the agent is enabled for this tenant. */
  enabled: boolean;
  /** Full config object (null if never configured). */
  config: AgentConfigData | null;
  /** True while the config is being fetched. */
  loading: boolean;
}

const AgentSettingsContext = createContext<AgentSettings>({
  enabled: false,
  config: null,
  loading: true,
});

export function AgentSettingsProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useAgentConfig();
  const config = data?.data ?? null;
  const enabled = config?.enabled ?? false;

  return (
    <AgentSettingsContext.Provider value={{ enabled, config, loading: isLoading }}>
      {children}
    </AgentSettingsContext.Provider>
  );
}

export function useAgentSettings() {
  return useContext(AgentSettingsContext);
}
