import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PersonasService } from './personas.service';
import { Auth } from 'src/decorators/auth.decorator';
import { Roles } from 'src/decorators/roles.decorator';
import { Role } from 'src/enums/roles.enum';
import { CurrentUser } from 'src/decorators/user.decorator';
import { AuditService } from 'src/shared/audit.service';
import {
  CreatePersonaDto,
  ImportPersonaDto,
  PutSectionDto,
  UpdatePersonaDto,
} from './dto/persona.dto';

@ApiTags('Personas')
@ApiBearerAuth()
@Auth()
@Roles(Role.ADMIN)
@Controller('api/personas')
export class PersonasController {
  constructor(
    private readonly personas: PersonasService,
    private readonly audit: AuditService,
  ) {}

  @ApiOperation({ summary: 'Список личностей' })
  @Get()
  list() {
    return this.personas.list();
  }

  @ApiOperation({ summary: 'Умолчания и подписи промптов' })
  @Get('prompts/defaults')
  promptDefaults() {
    return this.personas.promptDefaults();
  }

  @ApiOperation({ summary: 'Встроенные переменные ({name} и т. п.)' })
  @Get('variables/builtins')
  builtinVariables() {
    return this.personas.builtinVariables();
  }

  @ApiOperation({ summary: 'Ритм по умолчанию' })
  @Get('rhythm/defaults')
  rhythmDefaults() {
    return this.personas.rhythmDefaults();
  }

  @ApiOperation({ summary: 'Личность целиком, с документами' })
  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.personas.get(id);
  }

  @ApiOperation({ summary: 'Создать личность (можно копией существующей)' })
  @Post()
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  create(@Body() dto: CreatePersonaDto, @CurrentUser('id') userId: number) {
    return this.audit.wrap(
      { userId, action: 'persona.create', resource: dto.slug ?? dto.name },
      () => this.personas.create(dto),
    );
  }

  @ApiOperation({ summary: 'Копия личности со всеми документами' })
  @Post(':id/duplicate')
  @HttpCode(200)
  duplicate(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('id') userId: number,
  ) {
    return this.audit.wrap(
      { userId, action: 'persona.duplicate', resource: `persona:${id}` },
      () => this.personas.duplicate(id),
    );
  }

  @ApiOperation({ summary: 'Личность одним файлом: все секции' })
  @Get(':id/export')
  exportBundle(@Param('id', ParseIntPipe) id: number) {
    return this.personas.exportBundle(id);
  }

  @ApiOperation({ summary: 'Загрузить секции из файла (прежние — в историю)' })
  @Post(':id/import')
  @HttpCode(200)
  @UsePipes(new ValidationPipe({ whitelist: false }))
  importBundle(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ImportPersonaDto,
    @CurrentUser() user: { id: number; username: string },
  ) {
    return this.audit.wrap(
      { userId: user.id, action: 'persona.import', resource: `persona:${id}` },
      () =>
        this.personas.importBundle(id, dto.sections, user.username, dto.note),
    );
  }

  @ApiOperation({ summary: 'Имя, идентификатор, включена ли, заметки' })
  @Put(':id')
  @HttpCode(200)
  @UsePipes(ValidationPipe)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePersonaDto,
    @CurrentUser('id') userId: number,
  ) {
    return this.audit.wrap(
      {
        userId,
        action: 'persona.update',
        resource: `persona:${id}`,
        payload: dto,
      },
      () => this.personas.update(id, dto),
    );
  }

  @ApiOperation({ summary: 'Сделать личностью по умолчанию' })
  @Post(':id/default')
  @HttpCode(200)
  setDefault(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('id') userId: number,
  ) {
    return this.audit.wrap(
      { userId, action: 'persona.default', resource: `persona:${id}` },
      () => this.personas.setDefault(id),
    );
  }

  @ApiOperation({ summary: 'Удалить личность (если ею никто не говорит)' })
  @Delete(':id')
  @HttpCode(200)
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('id') userId: number,
  ) {
    return this.audit.wrap(
      { userId, action: 'persona.delete', resource: `persona:${id}` },
      () => this.personas.remove(id),
    );
  }

  @ApiOperation({ summary: 'Заменить документ секции целиком' })
  @Put(':id/sections/:section')
  @HttpCode(200)
  @UsePipes(new ValidationPipe({ whitelist: false }))
  putSection(
    @Param('id', ParseIntPipe) id: number,
    @Param('section') section: string,
    @Body() dto: PutSectionDto,
    @CurrentUser() user: { id: number; username: string },
  ) {
    return this.audit.wrap(
      {
        userId: user.id,
        action: 'persona.section',
        resource: `persona:${id}/${section}`,
      },
      () =>
        this.personas.putSection(
          id,
          section,
          dto.data,
          user.username,
          dto.note,
        ),
    );
  }

  @ApiOperation({ summary: 'История версий секции' })
  @Get(':id/sections/:section/versions')
  versions(
    @Param('id', ParseIntPipe) id: number,
    @Param('section') section: string,
  ) {
    return this.personas.listVersions(id, section);
  }

  @ApiOperation({ summary: 'Одна версия с документом' })
  @Get(':id/sections/:section/versions/:versionId')
  version(
    @Param('id', ParseIntPipe) id: number,
    @Param('section') section: string,
    @Param('versionId', ParseIntPipe) versionId: number,
  ) {
    return this.personas.getVersion(id, section, versionId);
  }

  @ApiOperation({ summary: 'Откатить секцию к версии' })
  @Post(':id/sections/:section/versions/:versionId/restore')
  @HttpCode(200)
  restore(
    @Param('id', ParseIntPipe) id: number,
    @Param('section') section: string,
    @Param('versionId', ParseIntPipe) versionId: number,
    @CurrentUser() user: { id: number; username: string },
  ) {
    return this.audit.wrap(
      {
        userId: user.id,
        action: 'persona.restore',
        resource: `persona:${id}/${section}#${versionId}`,
      },
      () => this.personas.restoreVersion(id, section, versionId, user.username),
    );
  }
}
