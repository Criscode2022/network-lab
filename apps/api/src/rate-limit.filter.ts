import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { RateLimitException } from './sim.service.ts';

/** Adds the standard Retry-After header to SimService rate-limit responses; the body stays Nest's usual shape. */
@Catch(RateLimitException)
export class RateLimitFilter implements ExceptionFilter<RateLimitException> {
  catch(exception: RateLimitException, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    res.setHeader('Retry-After', String(exception.retryAfterSec));
    res.status(exception.getStatus()).json({
      statusCode: exception.getStatus(),
      message: exception.message,
      error: 'Too Many Requests',
      retryAfter: exception.retryAfterSec,
    });
  }
}
