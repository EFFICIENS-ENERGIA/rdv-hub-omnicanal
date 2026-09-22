-- ==============================================================================
-- 🚀 RDV-HUB SAAS -- SCHÉMA SUPABASE CLOUD & RÈGLES DE SÉCURITÉ RLS
-- PostgreSQL 15+ / Supabase Auth & Storage
-- ==============================================================================

-- 1. EXTENSIONS REQUISES
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. TABLE DES PROFILS UTILISATEURS (Liée à auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id_user UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    nom TEXT,
    role TEXT DEFAULT 'collaborateur',
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Commentaires de table
COMMENT ON TABLE public.profiles IS 'Profils des collaborateurs et gestionnaires du RDV-Hub SaaS';

-- 3. TABLE DES CLIENTS (Omnicanal)
CREATE TABLE IF NOT EXISTS public.clients (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    nom TEXT NOT NULL,
    email TEXT,
    telephone TEXT,
    canal_origine TEXT DEFAULT 'web',
    score_ia INTEGER DEFAULT 50,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

COMMENT ON TABLE public.clients IS 'Répertoire des contacts et clients qualifiés omnicanaux';

-- Index de performance clients
CREATE INDEX IF NOT EXISTS idx_clients_user_id ON public.clients(user_id);
CREATE INDEX IF NOT EXISTS idx_clients_email ON public.clients(email);
CREATE INDEX IF NOT EXISTS idx_clients_canal ON public.clients(canal_origine);

-- 4. TABLE DES RENDEZ-VOUS (Pipeline Kanban & Agenda)
CREATE TABLE IF NOT EXISTS public.appointments (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    client_id TEXT REFERENCES public.clients(id) ON DELETE SET NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    client_name TEXT NOT NULL,
    subject TEXT NOT NULL,
    address TEXT DEFAULT 'Adresse à préciser',
    date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    status TEXT DEFAULT 'new',
    montant_prevu NUMERIC(12, 2) DEFAULT 0.00,
    montant_realise NUMERIC(12, 2) DEFAULT 0.00,
    urgency_level TEXT DEFAULT 'moyen',
    notes TEXT,
    lead_score INTEGER DEFAULT 50,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

COMMENT ON TABLE public.appointments IS 'Rendez-vous clients avec suivi des montants financiers et urgence IA';

-- Index de performance rendez-vous
CREATE INDEX IF NOT EXISTS idx_appointments_user_id ON public.appointments(user_id);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON public.appointments(date);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON public.appointments(status);
CREATE INDEX IF NOT EXISTS idx_appointments_client_id ON public.appointments(client_id);

-- ==============================================================================
-- 🔒 POLITIQUES DE SÉCURITÉ ROW LEVEL SECURITY (RLS)
-- Chaque utilisateur ne peut accéder qu'à ses propres profils, clients et rendez-vous
-- ==============================================================================

-- A. RLS SUR PROFILES
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own"
    ON public.profiles FOR SELECT
    USING (auth.uid() = id_user);

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id_user);

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own"
    ON public.profiles FOR INSERT
    WITH CHECK (auth.uid() = id_user);

-- B. RLS SUR CLIENTS
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clients_all_own" ON public.clients;
CREATE POLICY "clients_all_own"
    ON public.clients FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- C. RLS SUR APPOINTMENTS
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "appointments_all_own" ON public.appointments;
CREATE POLICY "appointments_all_own"
    ON public.appointments FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ==============================================================================
-- ⚙️ TRIGGER AUTOMATIQUE DE CRÉATION DE PROFIL LORS DE L'INSCRIPTION
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id_user, email, nom, role, created_at)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'nom', split_part(NEW.email, '@', 1)),
        COALESCE(NEW.raw_user_meta_data->>'role', 'collaborateur'),
        NOW()
    )
    ON CONFLICT (id_user) DO UPDATE
    SET email = EXCLUDED.email,
        nom = COALESCE(EXCLUDED.nom, public.profiles.nom);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Déclencheur après insertion dans auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ==============================================================================
-- 🔄 TRIGGER DE MISE À JOUR DE LA DATE (updated_at)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_updated_at ON public.appointments;
CREATE TRIGGER trigger_set_updated_at
    BEFORE UPDATE ON public.appointments
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Activation de la réplication en temps réel (Supabase Realtime)
ALTER PUBLICATION supabase_realtime ADD TABLE public.appointments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.clients;
