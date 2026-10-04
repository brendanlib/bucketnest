export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const badRequest = (message: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', message, details);
export const validationError = (message: string, details?: unknown) =>
  new AppError(400, 'VALIDATION_ERROR', message, details);
export const conflict = (code: string, message: string, details?: unknown) => new AppError(409, code, message, details);
export const unauthorized = (message = 'Please log in') => new AppError(401, 'UNAUTHENTICATED', message);
export const forbidden = (code: string, message: string) => new AppError(403, code, message);
export const tooManyRequests = (retryAfterSeconds: number) =>
  new AppError(429, 'RATE_LIMITED', 'Too many attempts. Please wait and try again.', { retryAfterSeconds });
