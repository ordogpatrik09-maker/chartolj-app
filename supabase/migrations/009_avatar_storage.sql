-- =====================================================================
-- 009_avatar_storage.sql — Profilkép tárolás (158-159. pont)
-- =====================================================================
-- Eddig a `profiles.avatar_url` mező LÉTEZETT és be is lett OLVASVA a
-- kliensben, de SOHA nem íródott — nem volt hozzá feltöltési felület,
-- és nem volt hozzá tárolóhely sem. Ez a migráció létrehozza a hiányzó
-- Storage bucket-et, felhasználó-specifikus elérési úttal (159. pont),
-- hogy egy felhasználó SOHA ne tudja felülírni vagy törölni egy másik
-- felhasználó profilképét.
--
-- ÚTVONAL-KONVENCIÓ: avatars/{user_id}/avatar.{kiterjesztés}
-- A kliens is ezt a mintát várja (lásd a chartolj_mobile.html
-- handleAvatarSelect() függvényét).
-- =====================================================================

-- A bucket NYILVÁNOS OLVASÁSRA van állítva (a profilképeket bárki
-- megnézheti, aki ismeri az URL-t — ez szokásos, alacsony kockázatú
-- gyakorlat profilképeknél), de ÍRÁSRA szigorúan felhasználó-specifikus.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
    public = true,
    file_size_limit = 2097152,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- Bárki olvashatja a profilképeket (a bucket maga is publikus, de RLS-szinten
-- is expliciten engedélyezzük, az egyértelműség kedvéért).
DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
CREATE POLICY "avatars_public_read"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'avatars');

-- A felhasználó KIZÁRÓLAG a saját mappájába (avatars/{a_saját_user_id}/...)
-- tölthet fel, írhat felül vagy törölhet — a foldername() az útvonal első
-- szegmensét adja vissza, amit a user_id-val hasonlítunk össze.
DROP POLICY IF EXISTS "avatars_insert_own_folder" ON storage.objects;
CREATE POLICY "avatars_insert_own_folder"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "avatars_update_own_folder" ON storage.objects;
CREATE POLICY "avatars_update_own_folder"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "avatars_delete_own_folder" ON storage.objects;
CREATE POLICY "avatars_delete_own_folder"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
