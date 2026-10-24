import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

/** Код региона в пути: 3–4 цифры. */
@Injectable()
export class ParseRegionPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!/^\d{3,4}$/.test(value ?? ''))
      throw new BadRequestException('регион должен содержать 3 или 4 цифры');
    return value;
  }
}
