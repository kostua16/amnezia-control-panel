-- Add unique constraint on ConfigTemplate.name
-- Deduplicate any existing duplicate names before applying constraint
-- (keep the newest row by id, remove older duplicates)

-- Step 1: Remove duplicate template names, keeping the row with the highest id
DELETE FROM config_templates
WHERE id NOT IN (
  SELECT MAX(id)
  FROM config_templates
  GROUP BY name
);

-- Step 2: Apply unique index
CREATE UNIQUE INDEX "config_templates_name_key" ON "config_templates"("name");
