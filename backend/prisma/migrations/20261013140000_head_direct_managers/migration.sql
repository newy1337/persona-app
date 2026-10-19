-- Менеджеры и тимлиды региона без руководителя подчиняются хеду региона.
UPDATE dashboard_users u
SET lead_id = h.id
FROM dashboard_users h
WHERE h.role = 'head'
  AND h.region_code IS NOT NULL
  AND h.region_code = u.region_code
  AND u.role IN ('manager', 'teamlead')
  AND u.lead_id IS NULL
  AND u.id <> h.id;
