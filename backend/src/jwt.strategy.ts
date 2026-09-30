import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { currentSession } from './shared/session-claims';
import { PrismaService } from './prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        ExtractJwt.fromUrlQueryParameter('token'),
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get('JWT_SECRET'),
    });
  }

  async validate(claims: any) {
    if (claims?.kind !== 'access' || !Number.isSafeInteger(claims.id))
      throw new UnauthorizedException();
    const user = await this.prisma.dashboardUser.findUnique({
      where: { id: claims.id },
    });
    if (
      !currentSession(
        claims,
        user,
        'access',
        this.configService.get('JWT_SECRET'),
      )
    )
      throw new UnauthorizedException();
    return user;
  }
}
