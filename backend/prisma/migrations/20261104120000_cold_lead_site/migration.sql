-- Холодка: источник — это сайт знакомств лида. Дозаполняем «Сайт» у лидов
-- и в карточке их диалогов ({site}), где он пуст.
UPDATE "leads"
SET "site" = CASE lower("source_type")
    WHEN 'drug_vokrug' THEN 'Друг Вокруг'
    ELSE replace("source_type", '_', ' ')
  END
WHERE "cold" AND ("site" IS NULL OR "site" = '');

UPDATE "pinned_facts" p
SET "facts" = jsonb_set(p."facts"::jsonb, '{site}', to_jsonb(l."site"))::text
FROM "leads" l
WHERE l."chat_id" = p."chat_id" AND l."cold" AND l."site" IS NOT NULL
  AND CASE WHEN p."facts" ~ '^\s*\{' THEN NOT (p."facts"::jsonb ? 'site') ELSE false END;
