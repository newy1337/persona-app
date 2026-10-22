import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';

/** Тело запроса «добавить в справочник» — одно и то же у доноров и источников. */
export class CatalogNameDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name: string;
}

/**
 * Имя для нового элемента справочника: без пробелов по краям, не пустое и без
 * повтора (регистр не важен). `find` ищет уже занятое имя в нужной таблице.
 */
export async function freeCatalogName(
  raw: string,
  words: { empty: string; taken: (existing: string) => string },
  find: (name: string) => Promise<{ name: string } | null>,
): Promise<string> {
  const name = raw.trim();
  if (!name) throw new UnprocessableEntityException(words.empty);
  const taken = await find(name);
  if (taken) throw new ConflictException(words.taken(taken.name));
  return name;
}
