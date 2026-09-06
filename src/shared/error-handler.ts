import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { AppError } from './errors.js';

/**
 * One place that turns any thrown value into an HTTP response.
 *
 * Two rules drive the design:
 *
 * 1. **Every error response has the same shape.** A frontend should be able to
 *    read `error.code` without special-casing per endpoint.
 * 2. **Never leak internals on a 5xx.** The full error goes to the logs; the
 *    client gets a generic message. Stack traces and driver errors in a response
 *    body are an information disclosure bug.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request: FastifyRequest, reply: FastifyReply) => {
    // --- Request failed schema validation (body/params/query) -> 400 ---
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.code(400).send({
        error: 'Bad Request',
        code: 'VALIDATION_ERROR',
        message: 'Request does not match the expected schema',
        details: error.validation,
        requestId: request.id,
      });
    }

    // --- A Zod parse we ran ourselves inside a service ---
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: 'Bad Request',
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: error.issues,
        requestId: request.id,
      });
    }

    // --- Errors we raised deliberately ---
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: error.name,
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
        requestId: request.id,
      });
    }

    // --- MongoDB duplicate key -> 409 ---
    // Mongo signals a unique-index violation with code 11000. Translating it here
    // means services can just insert and let the database enforce uniqueness,
    // rather than doing a check-then-insert that races under concurrency.
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
      const keyValue = (error as { keyValue?: Record<string, unknown> }).keyValue ?? {};
      const field = Object.keys(keyValue)[0] ?? 'field';
      return reply.code(409).send({
        error: 'Conflict',
        code: 'DUPLICATE_KEY',
        message: `A record with that ${field} already exists`,
        requestId: request.id,
      });
    }

    // --- Anything else is a bug: log everything, tell the client nothing ---
    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send({
      error: 'Internal Server Error',
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      requestId: request.id,
    });
  });

  // Consistent shape for unknown routes too, so clients never have to parse two
  // different error formats.
  app.setNotFoundHandler((request, reply) => {
    return reply.code(404).send({
      error: 'Not Found',
      code: 'ROUTE_NOT_FOUND',
      message: `Route ${request.method}:${request.url} not found`,
      requestId: request.id,
    });
  });
}
