import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { PrismaService } from '../prisma.service';
import { currentSession } from '../shared/session-claims';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token =
      this.extractTokenFromHeader(request) ??
      this.extractTokenFromQuery(request);
    if (!token) {
      throw new UnauthorizedException();
    }
    try {
      const tokens = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET,
      });
      if (tokens.kind !== 'access' || !Number.isSafeInteger(tokens.id))
        throw new UnauthorizedException();
      request['user'] = await this.prisma.dashboardUser.findUnique({
        where: { id: tokens.id },
      });
      if (!currentSession(tokens, request['user'], 'access'))
        throw new UnauthorizedException();
    } catch {
      throw new UnauthorizedException();
    }
    if (!request['user']) {
      throw new UnauthorizedException();
    }
    return true;
  }

  private extractTokenFromQuery(request: Request): string | undefined {
    if (request.method !== 'GET' && request.method !== 'HEAD') return undefined;
    const token = request.query?.['token'];
    return typeof token === 'string' && token ? token : undefined;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
