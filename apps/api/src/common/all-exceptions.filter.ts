import { ArgumentsHost, Catch, HttpException, HttpStatus, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { OmniError } from '@omni/shared';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const code = exception instanceof OmniError ? exception.code : exception instanceof HttpException ? 'HTTP_ERROR' : 'INTERNAL_ERROR';
    const message = exception instanceof Error ? exception.message : 'Unexpected error';
    const details = exception instanceof OmniError ? exception.details : {};
    response.status(status).json({ success: false, error: { code, message, details } });
  }
}
