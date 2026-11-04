-- Цели знакомства: тема «гражданство». Желательная, с самым низким приоритетом и
-- только после города — бот спрашивает к месту, а не анкетой. Добавляется
-- личностям, где её ещё нет; остальные темы не трогаем.
UPDATE "personas"
SET "goals" = jsonb_set(
      "goals"::jsonb,
      '{slots}',
      ("goals"::jsonb -> 'slots') || jsonb_build_array(jsonb_build_object(
        'id', 'citizenship',
        'hint', 'а ты гражданин России или другой страны?',
        'topic', 'гражданство: России или другой страны, есть ли второе гражданство или вид на жительство; спрашивай только к месту — когда разговор сам зашёл о родном городе, переезде, поездках за границу, загранпаспорте или работе в другой стране; не в лоб и не анкетой',
        'revisit', 'его поездки и планы на переезд',
        'priority', 12,
        'desired_by_day', 1,
        'requires', 'location'
      ))
    )::text,
    "updated_at" = extract(epoch from now())::int
WHERE CASE WHEN "goals" ~ '^\s*\{'
  THEN jsonb_typeof("goals"::jsonb -> 'slots') = 'array'
   AND NOT jsonb_path_exists("goals"::jsonb, '$.slots[*] ? (@.id == "citizenship")')
  ELSE false END;
