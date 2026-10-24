import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiKeysService } from 'src/modules/inbound/api-keys.service';

/** Доступ по заголовку X-Api-Key; ключи заводит админ в настройках. */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly keys: ApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const raw = request.headers['x-api-key'];
    const given = Array.isArray(raw) ? raw[0] : raw;
    if (typeof given !== 'string' || !given)
      throw new UnauthorizedException('нужен заголовок X-Api-Key');
    const key = await this.keys.verify(given);
    if (!key) throw new UnauthorizedException('ключ неверный или отозван');
    request['apiKey'] = key;
    return true;
  }
}
