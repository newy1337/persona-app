import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { DashboardUser } from '@prisma/client';

export const CurrentUser = createParamDecorator(
  (data: keyof DashboardUser, ctx: ExecutionContext) => {
    try {
      const request = ctx.switchToHttp().getRequest();
      const user = request.user;

      return data ? user[data] : user;
    } catch {
      return undefined;
    }
  },
);
