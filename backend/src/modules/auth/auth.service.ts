import {
  Injectable,
  OnModuleInit,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from 'src/prisma.service';
import { ClockService } from 'src/shared/clock.service';
import { AuditService } from 'src/shared/audit.service';
import { Role } from 'src/enums/roles.enum';
import { appConfig } from 'src/config/app.config';
import { LoginDto } from './dto/auth.dto';
import { credentialTag, currentSession } from 'src/shared/session-claims';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly log = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private clock: ClockService,
    private audit: AuditService,
  ) {}

  async onModuleInit() {
    if ((await this.prisma.dashboardUser.count()) > 0) return;
    if (!appConfig.adminPassword) {
      this.log.warn(
        'no users in the database and ADMIN_PASSWORD is empty — nobody can sign in',
      );
      return;
    }
    await this.prisma.dashboardUser.create({
      data: {
        username: appConfig.adminUsername,
        passwordHash: await argon2.hash(appConfig.adminPassword),
        role: Role.ADMIN,
        createdAt: this.clock.ts(),
      },
    });
    this.log.log(`seeded admin user "${appConfig.adminUsername}"`);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.dashboardUser.findUnique({
      where: { username: dto.username },
    });
    const ok = user && (await argon2.verify(user.passwordHash, dto.password));
    if (!ok) {
      await this.audit.log({
        userId: user?.id ?? null,
        action: 'auth.login',
        resource: dto.username,
        error: 'invalid credentials',
      });
      throw new UnauthorizedException('invalid credentials');
    }
    await this.prisma.dashboardUser.update({
      where: { id: user.id },
      data: { lastLogin: this.clock.ts() },
    });
    await this.audit.log({
      userId: user.id,
      action: 'auth.login',
      resource: dto.username,
    });
    const tokens = await this.generateToken(user);
    return { user: this.publicUser(user), tokens };
  }

  async refreshToken(refreshToken: string) {
    let result: {
      id: number;
      role: string;
      kind?: string;
      credential?: string;
    };
    try {
      result = await this.jwt.verifyAsync(refreshToken);
      if (result.kind !== 'refresh' || !Number.isSafeInteger(result.id))
        throw new Error('Invalid refresh claims');
    } catch {
      throw new UnauthorizedException('Invalid Refresh Token');
    }
    const user = await this.prisma.dashboardUser.findUnique({
      where: { id: result.id },
    });
    if (!currentSession(result, user, 'refresh'))
      throw new UnauthorizedException('Invalid Refresh Token');
    const tokens = await this.generateToken(user!);
    return { user: this.publicUser(user!), tokens };
  }

  me(user: {
    id: number;
    username: string;
    role: string;
    lastLogin: number | null;
  }) {
    return this.publicUser(user);
  }

  publicUser(user: {
    id: number;
    username: string;
    role: string;
    lastLogin: number | null;
  }) {
    return {
      user_id: user.id,
      username: user.username,
      role: user.role,
      last_login: user.lastLogin,
    };
  }

  private async generateToken(user: {
    id: number;
    role: string;
    passwordHash: string;
  }) {
    const data = {
      id: user.id,
      role: user.role,
      credential: credentialTag(user),
    };
    const accessToken = this.jwt.sign(
      { ...data, kind: 'access' },
      { expiresIn: '10h' },
    );
    const refreshToken = this.jwt.sign(
      { ...data, kind: 'refresh' },
      { expiresIn: '168h' },
    );
    return { accessToken, refreshToken };
  }
}
