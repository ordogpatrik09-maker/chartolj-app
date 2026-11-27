-- =====================================================================
-- 033_live_sessions.sql — Élő órák (YouTube Live) órarendje (ÚJ, ADDITÍV)
-- =====================================================================
-- Az admin (ugyanaz az e-mail-ellenőrzés, mint a 020-ban) veszi fel az
-- alkalmakat: cím, leírás, kezdés, hossz, YouTube videó-azonosító. Az
-- órarendet bárki (vendég is) olvashatja — nyilvános tartalom.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.live_sessions (
    id           bigserial PRIMARY KEY,
    title        text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
    description  text CHECK (description IS NULL OR length(description) <= 600),
    starts_at    timestamptz NOT NULL,
    duration_min integer NOT NULL DEFAULT 60 CHECK (duration_min BETWEEN 5 AND 600),
    youtube_id   text CHECK (youtube_id IS NULL OR youtube_id ~ '^[A-Za-z0-9_-]{6,20}$'),
    premium_only boolean NOT NULL DEFAULT false,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_live_sessions_start ON public.live_sessions (starts_at);
ALTER TABLE public.live_sessions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.get_live_sessions()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'description', description, 'starts_at', starts_at,
               'duration_min', duration_min, 'youtube_id', youtube_id, 'premium_only', premium_only) ORDER BY starts_at), '[]'::jsonb)
    FROM (SELECT * FROM public.live_sessions
          WHERE starts_at + make_interval(mins => duration_min) > now() - interval '14 days'
          ORDER BY starts_at LIMIT 50) s;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_live_session(p_id bigint, p_title text, p_description text, p_starts_at timestamptz,
                                                           p_duration_min integer, p_youtube_id text, p_premium_only boolean DEFAULT false)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id bigint;
BEGIN
    IF lower(coalesce(auth.jwt() ->> 'email', '')) NOT IN ('patrik66@gmail.com') THEN
        RAISE EXCEPTION 'Nincs jogosultság ehhez a művelethez.' USING ERRCODE = '42501';
    END IF;
    IF p_id IS NULL THEN
        INSERT INTO public.live_sessions (title, description, starts_at, duration_min, youtube_id, premium_only)
        VALUES (trim(p_title), nullif(trim(p_description), ''), p_starts_at, coalesce(p_duration_min, 60), nullif(trim(p_youtube_id), ''), coalesce(p_premium_only, false))
        RETURNING id INTO v_id;
    ELSE
        UPDATE public.live_sessions SET title = trim(p_title), description = nullif(trim(p_description), ''), starts_at = p_starts_at,
            duration_min = coalesce(p_duration_min, 60), youtube_id = nullif(trim(p_youtube_id), ''), premium_only = coalesce(p_premium_only, false)
        WHERE id = p_id RETURNING id INTO v_id;
    END IF;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_live_session(p_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF lower(coalesce(auth.jwt() ->> 'email', '')) NOT IN ('patrik66@gmail.com') THEN
        RAISE EXCEPTION 'Nincs jogosultság ehhez a művelethez.' USING ERRCODE = '42501';
    END IF;
    DELETE FROM public.live_sessions WHERE id = p_id;
    RETURN FOUND;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_live_sessions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_live_sessions() TO anon, authenticated;
DO $$
DECLARE f text;
BEGIN
    FOREACH f IN ARRAY ARRAY['admin_upsert_live_session(bigint, text, text, timestamptz, integer, text, boolean)', 'admin_delete_live_session(bigint)'] LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC', f);
        EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM anon', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
    END LOOP;
END $$;
