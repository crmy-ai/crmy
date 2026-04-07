// File: src/db/repos/opportunities.ts
import { OpportunityManager } from '../services/StatePatternManagerService';
import { OpportunityModel } from '../types/models'; // Assuming a type definition exists

/**
 * Wraps calls to the underlying CRM API/Tooling to manage opportunity state transitions.
 * All direct state changes MUST pass through StatePatternManagerService.
 */
export const OpportunityRepo = {
    /**
     * Updates the opportunity stage using the State Pattern Manager.
     */
    advanceStage: async (id: string, newState: 'prospecting' | 'qualification' | 'proposal' | 'negotiation' | 'closed_won' | 'closed_lost', reason?: string): Promise<OpportunityModel> => {
        // *** OLD LOGIC HERE ***
        // Original logic calling mcp__crmy__opportunity_advance_stage(...)

        // *** NEW LOGIC: DELEGATE TO STATE MANAGER ***
        return StatePatternManagerService.advanceOpportunityState(id, `TRANSITION_TO_${newState.toUpperCase()}`);
    }
    // ... other read/write methods
};