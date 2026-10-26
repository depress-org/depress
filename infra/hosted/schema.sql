-- Dedicated database/role only. Source migration; never auto-run on a production DB.
CREATE TABLE IF NOT EXISTS private_jobs25 (
 id uuid PRIMARY KEY, owner_id text NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 128),
 state text NOT NULL CHECK (state IN ('queued','running','stopping','done','failed')),
 lease_id uuid, created_ms bigint NOT NULL, expires_ms bigint NOT NULL,
 deadline_ms bigint, artifact_expires_ms bigint,
 input bytea CHECK (octet_length(input) <= 1500000),
 input_bytes integer NOT NULL CHECK (input_bytes BETWEEN 0 AND 1048576),
 artifact bytea CHECK (octet_length(artifact) <= 1500000),
 artifact_digest text CHECK (artifact_digest ~ '^[a-f0-9]{64}$'),
 cleanup_attempts integer NOT NULL DEFAULT 0 CHECK (cleanup_attempts >= 0),
 CHECK ((state = 'queued' AND lease_id IS NULL) OR state <> 'queued'),
 CHECK (state NOT IN ('done','failed') OR (input IS NULL AND input_bytes = 0)),
 CHECK ((artifact IS NULL AND artifact_digest IS NULL) OR (artifact IS NOT NULL AND artifact_digest IS NOT NULL AND state = 'done'))
);
CREATE INDEX IF NOT EXISTS private_jobs25_owner ON private_jobs25(owner_id);
CREATE TABLE IF NOT EXISTS private_uploads25 (
 id uuid PRIMARY KEY, owner_id text NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 128), expires_ms bigint NOT NULL
);
-- Owner/id/creation are immutable even if a controller mistakenly supplies a patch.
CREATE OR REPLACE FUNCTION private_jobs25_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id <> OLD.id OR NEW.owner_id <> OLD.owner_id OR NEW.created_ms <> OLD.created_ms THEN
  RAISE EXCEPTION 'immutable identity';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS private_jobs25_identity ON private_jobs25;
CREATE TRIGGER private_jobs25_identity BEFORE UPDATE ON private_jobs25 FOR EACH ROW EXECUTE FUNCTION private_jobs25_identity();
