import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, finalize } from 'rxjs';
import { ManagerService } from './manager.service';

/**
 * Любое действие в панели (не GET) сбрасывает кеш опросов: после паузы,
 * ответа или смены этапа список и очередь должны обновиться сразу, а не
 * через несколько секунд.
 */
@Injectable()
export class PollCacheInterceptor implements NestInterceptor {
  constructor(private readonly manager: ManagerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const method = context
      .switchToHttp()
      .getRequest<{ method?: string }>()?.method;
    if (!method || method === 'GET' || method === 'HEAD') return next.handle();
    return next.handle().pipe(finalize(() => this.manager.forgetPolls()));
  }
}
