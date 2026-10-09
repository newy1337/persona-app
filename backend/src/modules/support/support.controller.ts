import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Auth } from 'src/decorators/auth.decorator';
import { CurrentUser } from 'src/decorators/user.decorator';
import { DashboardUser } from '@prisma/client';
import {
  MAX_FILES,
  MAX_FILE_BYTES,
  SupportFile,
  SupportService,
} from './support.service';

@ApiTags('Support')
@ApiBearerAuth()
@Auth()
@Controller('api/support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @ApiOperation({ summary: 'Настроена ли отправка в поддержку' })
  @Get('status')
  status() {
    return { configured: this.support.configured };
  }

  @ApiOperation({ summary: 'Жалоба в поддержку: текст и до 5 скриншотов' })
  @ApiConsumes('multipart/form-data')
  @Post('report')
  @HttpCode(202)
  @UseInterceptors(
    // В памяти, не на диске; лимиты режут запрос до того, как он дойдёт до сервиса.
    FilesInterceptor('files', MAX_FILES, {
      limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES, fields: 4 },
    }),
  )
  report(
    @CurrentUser() user: DashboardUser,
    @Body() body: { text?: string; page?: string },
    @UploadedFiles() files: SupportFile[] = [],
  ) {
    return this.support.send(
      { id: user.id, username: user.username, role: user.role },
      { text: body?.text ?? '', page: body?.page, files },
    );
  }
}
