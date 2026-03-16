import React, { createContext, useContext, useState } from 'react';

export interface AgentSettings {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
}

const AgentSettingsContext = createContext<AgentSettings>({
  enabled: false,
  setEnabled: () => {},
});

export function AgentSettingsProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  return (
    <AgentSettingsContext.Provider value={{ enabled, setEnabled }}>
      {children}
    </AgentSettingsContext.Provider>
  );
}

export function useAgentSettings() {
  return useContext(AgentSettingsContext);
}
