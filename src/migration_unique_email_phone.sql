-- A executer une fois si la table submissions existe deja sans index uniques.
-- Echoue s'il existe des doublons : dedupliquez d'abord les lignes concernees.

CREATE UNIQUE INDEX IF NOT EXISTS submissions_phone_unique ON submissions (phone);
CREATE UNIQUE INDEX IF NOT EXISTS submissions_email_unique ON submissions (email);
