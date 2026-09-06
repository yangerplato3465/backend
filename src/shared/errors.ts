/**
 * Typed application errors.
 *
 * The point is that service code can throw a meaningful error without knowing
 * anything about HTTP, and one central handler turns it into a response. Without
 * this you end up passing `reply` down into business logic, which makes that
 * logic untestable and impossible to reuse outside a request.
 */
export class AppError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** 404 — the resource genuinely does not exist. */
export class NotFoundError extends AppError {
  constructor(resource: string, identifier?: string) {
    super(
      identifier ? `${resource} '${identifier}' not found` : `${resource} not found`,
      404,
      'NOT_FOUND',
    );
  }
}

/** 409 — the request is valid but conflicts with existing state (duplicate slug). */
export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 409, 'CONFLICT', details);
  }
}

/** 400 — the request itself is malformed in a way schemas did not catch. */
export class BadRequestError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'BAD_REQUEST', details);
  }
}
