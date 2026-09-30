import { UseGuards } from '@nestjs/common';
import { AuthGuard } from '../guards/auth.guard';
import { RolesGuard } from '../guards/roles.guards';

export const Auth = () => UseGuards(AuthGuard, RolesGuard);
