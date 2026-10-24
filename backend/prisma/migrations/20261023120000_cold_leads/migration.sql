-- Холодка: лиды без региона и личности, раздаются поровну сотрудникам регионов,
-- где она включена, и только тем, у кого она включена лично.
ALTER TABLE "region_settings" ADD COLUMN "accept_cold" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "dashboard_users" ADD COLUMN "cold_leads" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "phone_numbers" ADD COLUMN "cold" BOOLEAN NOT NULL DEFAULT false;
