-- The fiscal reference table must exist before the following migration
-- installs its row-level security policies.
CREATE TABLE IF NOT EXISTS public.assurance_regles_fiscales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  libelle text NOT NULL,
  taux numeric(8,5),
  contribution_fixe numeric(12,2) NOT NULL DEFAULT 0,
  unite_contribution text NOT NULL DEFAULT 'annuelle',
  actif boolean NOT NULL DEFAULT true,
  date_debut date NOT NULL,
  date_fin date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
