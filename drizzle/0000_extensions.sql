-- Custom migration: extensions needed before the schema (trigram indexes for Thai name search).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
