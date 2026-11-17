ALTER TABLE calorie_target ADD COLUMN protein_g double precision CHECK (protein_g IS NULL OR protein_g >= 0);
ALTER TABLE calorie_target ADD COLUMN carbs_g double precision CHECK (carbs_g IS NULL OR carbs_g >= 0);
ALTER TABLE calorie_target ADD COLUMN fat_g double precision CHECK (fat_g IS NULL OR fat_g >= 0);
ALTER TABLE calorie_target ADD COLUMN fibre_g double precision CHECK (fibre_g IS NULL OR fibre_g >= 0);
