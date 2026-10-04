import type { FastifyError, FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';
import { AppError } from '../lib/errors.js';
import { MoneyError } from '../finance/money.js';

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

const body = (code: string, message: string, details?: unknown): ErrorBody => ({
  error: { code, message, ...(details !== undefined ? { details } : {}) },
});

/**
 * One error shape for every failure: { error: { code, message, details } }.
 * Stack traces and internal messages never reach the client.
 */
export function registerErrorHandling(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError | AppError | Error, request, reply) => {
    if (err instanceof AppError) {
      if (err.statusCode >= 500) request.log.error({ err }, err.message);
      return reply.status(err.statusCode).send(body(err.code, err.message, err.details));
    }

    if (hasZodFastifySchemaValidationErrors(err)) {
      const issues = err.validation.map((v) => ({
        field: `${err.validationContext ?? 'body'}${v.instancePath.replace(/\//g, '.')}`.replace(/\.$/, ''),
        message: v.message ?? 'Invalid value',
      }));
      return reply.status(400).send(body('VALIDATION_ERROR', issues[0]?.message ?? 'Invalid request', issues));
    }

    if (isResponseSerializationError(err)) {
      request.log.error({ issues: err.cause.issues, url: request.url }, 'response did not match its schema');
      return reply.status(500).send(body('INTERNAL', 'Something went wrong'));
    }

    if (err instanceof MoneyError) {
      return reply.status(400).send(body('VALIDATION_ERROR', err.message));
    }

    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return reply.status(404).send(body('NOT_FOUND', 'Resource not found'));
      if (err.code === 'P2002') return reply.status(409).send(body('CONFLICT', 'That already exists'));
      if (err.code === 'P2003') return reply.status(409).send(body('IN_USE', 'This record is still referenced by other records'));
    }

    const status = (err as FastifyError).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      const code = (err as FastifyError).code ?? 'BAD_REQUEST';
      return reply.status(status).send(body(code.replace(/^FST_ERR_/, ''), err.message));
    }

    request.log.error({ err }, 'unhandled error');
    return reply.status(500).send(body('INTERNAL', 'Something went wrong'));
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send(body('NOT_FOUND', 'Route not found'));
  });
}
