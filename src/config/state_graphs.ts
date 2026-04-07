// File: src/config/state_graphs.ts

/**
 * Centralized configuration for all business process state transitions.
 * Structure: { Entity: { CurrentState: { TargetState: { conditions: [], mandatoryActivity: "type" } } } }
 */

export const OpportunityGraph = {
    prospecting: {
        qualification: {
            conditions: ['activity.type=meeting', 'activity.details.type=qualification'],
            mandatoryActivity: 'meeting',
            // ... other conditions
        }
    },
    qualification: {
        proposal: {
            conditions: ['context.type=objection', 'context.status=reviewed'],
            mandatoryActivity: 'note', // Or a specific activity
        }
    },
    // ... other states
};

export const UseCaseGraph = {
    discovery: {
        poc: {
            conditions: ['context.type=research', 'context.body~/(Pilot|Proof of Concept)/i'],
            mandatoryActivity: 'research',
        }
    },
    // ... other states
};

export const AssignmentGraph = {
    pending: {
        accepted: {
            conditions: [],
            mandatoryActivity: 'none',
        }
    },
    // ... other states
};