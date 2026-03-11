export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'QUOTA_EXCEEDED'
  | 'CONFLICT'
  | 'UNAUTHORIZED'
  | 'INTERNAL_ERROR';

export class CrmyError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number = 400,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'CrmyError';
  }

  toJSON() {
    return {
      type: `https://crmy.ai/errors/${this.code.toLowerCase()}`,
      title: this.code.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      status: this.status,
      detail: this.message,
      ...this.details,
    };
  }
}

export function notFound(entity: string, id: string): CrmyError {
  return new CrmyError('NOT_FOUND', `${entity} ${id} not found`, 404);
}

export function validationError(message: string, errors?: { field: string; message: string }[]): CrmyError {
  return new CrmyError('VALIDATION_ERROR', message, 422, errors ? { errors } : undefined);
}

export function permissionDenied(message = 'Permission denied'): CrmyError {
  return new CrmyError('PERMISSION_DENIED', message, 403);
}

export function unauthorized(message = 'Unauthorized'): CrmyError {
  return new CrmyError('UNAUTHORIZED', message, 401);
}
