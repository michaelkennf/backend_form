-- Base déjà en production sans colonnes de localisation : exécuter une fois.
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS city_or_territory TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS commune_or_sector TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS quarter TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS consent_method TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS consent_text TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS consent_accepted_at TIMESTAMPTZ;

UPDATE submissions
SET city_or_territory = province
WHERE city_or_territory IS NULL OR trim(city_or_territory) = '';

UPDATE submissions
SET commune_or_sector = '—'
WHERE commune_or_sector IS NULL OR trim(commune_or_sector) = '';

UPDATE submissions
SET consent_method = 'case-a-cocher-formulaire-public'
WHERE consent_method IS NULL OR trim(consent_method) = '';

UPDATE submissions
SET consent_text = 'Consentement enregistre (version precedente du formulaire).'
WHERE consent_text IS NULL OR trim(consent_text) = '';

UPDATE submissions
SET consent_accepted_at = created_at
WHERE consent_accepted_at IS NULL;

ALTER TABLE submissions ALTER COLUMN city_or_territory SET NOT NULL;
ALTER TABLE submissions ALTER COLUMN commune_or_sector SET NOT NULL;
ALTER TABLE submissions ALTER COLUMN consent_method SET NOT NULL;
ALTER TABLE submissions ALTER COLUMN consent_text SET NOT NULL;
ALTER TABLE submissions ALTER COLUMN consent_accepted_at SET NOT NULL;
