import {
  Body,
  Controller,
  Logger,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { unknownFields, usernameFrom } from 'src/domain/inbound-fields';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from 'src/guards/api-key.guard';
import { InboundLeadDto } from './dto/inbound-lead.dto';
import { ColdLeadDto } from './dto/cold-lead.dto';
import { InboundService } from './inbound.service';

const INBOUND_FIELDS = [
  'name',
  'phone',
  'username',
  'donor',
  'region',
  'person',
  'reassigned',
  'source',
  'account',
  'age',
  'gender',
  'city',
  'external_id',
  'profile_url',
  'last_messages',
];
const COLD_FIELDS = [
  'source',
  'persona',
  'phone',
  'username',
  'name',
  'gender',
  'city',
  'age',
];

@ApiTags('inbound')
@ApiHeader({ name: 'X-Api-Key', description: 'ключ из настроек панели' })
@UseGuards(ApiKeyGuard)
@Controller('api/post')
export class InboundController {
  private readonly log = new Logger(InboundController.name);
  private readonly reported = new Set<string>();

  constructor(private readonly inbound: InboundService) {}

  /**
   * Проверка тела выкидывает неизвестные поля молча. Ник под другим именем
   * (tg, telegram, tg_username…) берём из сырого тела, а про остальные
   * незнакомые поля один раз пишем в лог — так расхождение с отправителем видно.
   */
  private withAliases<T extends { username?: string }>(
    route: string,
    dto: T,
    req: Request,
    known: readonly string[],
  ): T {
    if (!dto.username) {
      const alias = usernameFrom(req.body);
      if (alias) dto.username = alias;
    }
    const extra = unknownFields(req.body, known);
    const key = `${route}:${extra.join(',')}`;
    if (extra.length && !this.reported.has(key)) {
      this.reported.add(key);
      this.log.warn(
        `${route}: незнакомые поля в запросе — ${extra.join(', ')} (не сохраняются)`,
      );
    }
    return dto;
  }

  @ApiOperation({
    summary:
      'Принять лид от внешней системы и раздать менеджеру онлайн по источнику, донору и лимиту',
  })
  @ApiResponse({
    status: 201,
    description: 'лид создан; assigned_to — кому ушёл',
  })
  @ApiResponse({ status: 409, description: 'такой телефон или ник уже в базе' })
  @ApiResponse({
    status: 422,
    description:
      'error: no_recipient — нет подходящего сотрудника, лид не сохранён, message — причина',
  })
  @ApiResponse({
    status: 401,
    description: 'ключ не передан, неверный или отозван',
  })
  @Post('leads')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  accept(@Body() dto: InboundLeadDto, @Req() req: Request) {
    return this.inbound.accept(
      this.withAliases('/api/post/leads', dto, req, INBOUND_FIELDS),
    );
  }

  @ApiOperation({
    summary:
      'Холодка: лид без региона и личности, поровну тем, у кого холодка включена',
  })
  @ApiResponse({
    status: 201,
    description: 'лид создан; assigned_to — кому ушёл',
  })
  @ApiResponse({ status: 409, description: 'такой телефон или ник уже в базе' })
  @ApiResponse({
    status: 422,
    description:
      'error: no_recipient — холодку сейчас никто не может принять, лид не сохранён',
  })
  @ApiResponse({
    status: 401,
    description: 'ключ не передан, неверный или отозван',
  })
  @Post('cold')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  acceptCold(@Body() dto: ColdLeadDto, @Req() req: Request) {
    return this.inbound.acceptCold(
      this.withAliases('/api/post/cold', dto, req, COLD_FIELDS),
    );
  }
}
