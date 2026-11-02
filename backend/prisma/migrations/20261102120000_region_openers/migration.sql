-- Пул первых сообщений региона для личности: хед правит сам.
CREATE TABLE "region_openers" (
    "region_code" TEXT NOT NULL,
    "persona_slug" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "updated_at" INTEGER NOT NULL,
    "updated_by_id" INTEGER,
    CONSTRAINT "region_openers_pkey" PRIMARY KEY ("region_code","persona_slug")
);
