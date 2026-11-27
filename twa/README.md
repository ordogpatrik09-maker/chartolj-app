# Chartolj! — Android (Play Store) csomag, TWA

Az app egy Trusted Web Activity (TWA) csomagban kerülhet a Play Store-ba: a
telefonon teljes képernyős, böngészősáv nélküli appként fut, a tartalom pedig
továbbra is a GitHub Pages-ről jön (minden frissítés azonnal megjelenik, új
APK nélkül).

## Amit neked kell elvégezned (egyszer)

1. **Gépedre:** Node.js, JDK 17 és Android SDK (a Bubblewrap első futáskor
   felajánlja a letöltésüket). Majd: `npm i -g @bubblewrap/cli`
2. **Csomag készítése** ebben a mappában:
   `bubblewrap init --manifest=https://ordogpatrik09-maker.github.io/chartolj-app/manifest.webmanifest`
   (a kérdéseknél a `twa-manifest.json` értékeit használd — csomagnév:
   `hu.chartolj.app`), utána `bubblewrap build`. Az eredmény:
   `app-release-bundle.aab`. A létrejövő `android.keystore`-t és a jelszavát
   **őrizd meg biztonságos helyen** — enélkül nem tudsz frissítést kiadni.
3. **Play Console:** új app, töltsd fel az `.aab`-t. A *Beállítás → App
   integritása* oldalon másold ki az **App signing key SHA-256** ujjlenyomatát.
4. **Domain-igazolás (fontos!):** a `assetlinks.json.template` alapján
   (ujjlenyomat beírva) hozz létre egy `assetlinks.json`-t, és tedd ide:
   `https://ordogpatrik09-maker.github.io/.well-known/assetlinks.json`
   — ez a **domain gyökere**, vagyis a `ordogpatrik09-maker.github.io` nevű
   (felhasználói) GitHub Pages repóba kell tenni, NEM ebbe a repóba (ez a
   `/chartolj-app/` almappában fut). Ha nincs ilyen repód, hozz létre egyet
   ezzel a névvel. Ha később saját domaint kötsz be, oda kell tenni.
   Igazolás nélkül az app böngészősávval nyílik meg.
5. **Fizetés:** a `verify-play-purchase` Edge Function
   `GOOGLE_PLAY_PACKAGE_NAME` titkát állítsd `hu.chartolj.app`-ra, és add meg
   a szolgáltatásfiók JSON-t (lásd a függvény fejkommentjét).

## Ellenőrzés

- Telefonon telepítés után nincs URL-sáv → a domain-igazolás jó.
- `https://ordogpatrik09-maker.github.io/.well-known/assetlinks.json`
  böngészőben megnyitva a fenti JSON-t mutatja.
