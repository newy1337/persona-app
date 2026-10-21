import {
  Body,
  Controller,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from 'src/guards/api-key.guard';
import { InboundLeadDto } from './dto/inbound-lead.dto';
import { ColdLeadDto } from './dto/cold-lead.dto';
import { InboundService } from './inbound.service';

@ApiTags('inbound')
@ApiHeader({ name: 'X-Api-Key', description: 'ключ из настроек панели' })
@UseGuards(ApiKeyGuard)
@Controller('api/post')
export class InboundController {
  constructor(private readonly inbound: InboundService) {}

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
  accept(@Body() dto: InboundLeadDto) {
    return this.inbound.accept(dto);
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
  acceptCold(@Body() dto: ColdLeadDto) {
    return this.inbound.acceptCold(dto);
  }
}
