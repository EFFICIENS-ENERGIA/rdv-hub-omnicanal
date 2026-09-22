-- ==============================================================================
-- SCRIPT SQL UNIFIÉ D'INITIALISATION SUPABASE CLOUD (DIRECTIVE 7 & RÈGLE 21)
-- Table public.profiles + RLS + Trigger d'Inscription + Storage Bucket Avatars
-- ==============================================================================

-- 1. Table des Profils Utilisateurs
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  full_name TEXT,
  avatar_url TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Activation de la Sécurité RLS (Row Level Security)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 3. Politiques RLS sur public.profiles
DROP POLICY IF EXISTS "Les profils sont consultables par tout le monde" ON public.profiles;
CREATE POLICY "Les profils sont consultables par tout le monde"
  ON public.profiles FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Les utilisateurs peuvent insérer leur propre profil" ON public.profiles;
CREATE POLICY "Les utilisateurs peuvent insérer leur propre profil"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Les utilisateurs peuvent modifier leur propre profil" ON public.profiles;
CREATE POLICY "Les utilisateurs peuvent modifier leur propre profil"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- 4. Fonction & Trigger Automatique lors de l'Inscription (Email / OAuth)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''),
    COALESCE(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture', '')
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    avatar_url = EXCLUDED.avatar_url,
    updated_at = now();
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 5. Configuration Supabase Storage (Bucket "avatars")
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Politiques RLS sur storage.objects pour le bucket "avatars"
DROP POLICY IF EXISTS "Les avatars sont publiquement consultables" ON storage.objects;
CREATE POLICY "Les avatars sont publiquement consultables"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Chaque utilisateur peut téléverser son propre avatar" ON storage.objects;
CREATE POLICY "Chaque utilisateur peut téléverser son propre avatar"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Chaque utilisateur peut modifier son propre avatar" ON storage.objects;
CREATE POLICY "Chaque utilisateur peut modifier son propre avatar"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'avatars' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Chaque utilisateur peut supprimer son propre avatar" ON storage.objects;
CREATE POLICY "Chaque utilisateur peut supprimer son propre avatar"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'avatars' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );