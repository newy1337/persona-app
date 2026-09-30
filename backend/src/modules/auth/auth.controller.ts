import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto, RefreshTokenDto } from './dto/auth.dto';
import { Auth } from 'src/decorators/auth.decorator';
import { CurrentUser } from 'src/decorators/user.decorator';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({ summary: 'Sign in with username and password' })
  @UsePipes(new ValidationPipe())
  @HttpCode(200)
  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @ApiOperation({ summary: 'User Token Refresh' })
  @UsePipes(new ValidationPipe())
  @HttpCode(200)
  @Post('token/refresh')
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshToken(dto.refreshToken);
  }

  @ApiOperation({ summary: 'Current user' })
  @ApiBearerAuth()
  @Auth()
  @Get('me')
  async me(@CurrentUser() user) {
    return this.authService.me(user);
  }

  @ApiOperation({
    summary: 'Sign out (stateless: the client drops its tokens)',
  })
  @ApiBearerAuth()
  @Auth()
  @HttpCode(200)
  @Post('logout')
  async logout() {
    return { status: 'logged_out' };
  }
}
