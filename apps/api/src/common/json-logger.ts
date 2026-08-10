import type { LoggerService } from '@nestjs/common';

export class JsonLogger implements LoggerService {
  private write(level: string, message: unknown, context?: string): void {
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      context,
      message: typeof message === 'string' ? message : JSON.stringify(message),
    });
    if (level === 'error') console.error(entry);
    else if (level === 'warn') console.warn(entry);
    else console.log(entry);
  }
  log(message: unknown, context?: string): void { this.write('info', message, context); }
  error(message: unknown, trace?: string, context?: string): void { this.write('error', { message, trace }, context); }
  warn(message: unknown, context?: string): void { this.write('warn', message, context); }
  debug(message: unknown, context?: string): void { this.write('debug', message, context); }
  verbose(message: unknown, context?: string): void { this.write('trace', message, context); }
}
