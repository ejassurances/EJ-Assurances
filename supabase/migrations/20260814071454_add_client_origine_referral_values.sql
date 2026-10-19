-- The client value scoring migration immediately following this file counts referrals.
-- Keep the source enum aligned with the supported referral categories.
ALTER TYPE public.client_origine ADD VALUE IF NOT EXISTS 'parrainage';
ALTER TYPE public.client_origine ADD VALUE IF NOT EXISTS 'recommandation';
