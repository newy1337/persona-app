import { Injectable } from '@nestjs/common';

@Injectable()
export class ClockService {
  now(): Date {
    return new Date();
  }

  ts(): number {
    return Math.floor(this.now().getTime() / 1000);
  }
}
