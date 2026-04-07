// Placeholder error class for structured error handling
export class StateTransitionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "StateTransitionError";
    }
}