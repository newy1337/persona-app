import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { withContactAliases } from 'src/domain/inbound-fields';

/**
 * Ник и мессенджер под другими именами полей — в наши до проверки тела:
 * перехватчик выполняется раньше pipes.
 */
@Injectable()
export class ContactAliasesInterceptor implements NestInterceptor {
  constructor(private readonly messenger = false) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest<Request>();
    req.body = withContactAliases(req.body, { messenger: this.messenger });
    return next.handle();
  }
}
