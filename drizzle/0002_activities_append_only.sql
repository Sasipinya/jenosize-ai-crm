-- Custom migration: activities is an append-only audit trail.
-- Any UPDATE, DELETE or TRUNCATE is rejected at the database level.
CREATE OR REPLACE FUNCTION activities_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'activities is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER activities_no_update_delete
  BEFORE UPDATE OR DELETE ON activities
  FOR EACH ROW EXECUTE FUNCTION activities_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER activities_no_truncate
  BEFORE TRUNCATE ON activities
  FOR EACH STATEMENT EXECUTE FUNCTION activities_reject_mutation();
