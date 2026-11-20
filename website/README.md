# Chartolj! – weboldal (1. szelet)

Statikus, függőségmentes marketing-oldal a meglévő Chartolj! alkalmazás elé. Az alkalmazás (`app/index.html`) **érintetlen másolat** a feltöltött fájlról.

## Futtatás
```
python3 scripts/build.py            # oldalak + js/locales.js generálása (409 szöveg x hu/en/de, paritás-ellenőrzéssel)
node tests/tools.test.js            # kalkulátor-tesztek
python3 -m http.server 8000         # majd http://localhost:8000
```
Éles buildhez: `SITE_URL=https://a-te-domained python3 scripts/build.py` (canonical, og:url, sitemap.xml csak ekkor készül).

## Szerkesztés
- Szövegek: `scripts/strings.py` (egyetlen forrás, 3 nyelv). Oldalak: `scripts/build.py`. Stílus: `css/design-system.css` (tokenek, komponensek).
- Beállítások: `js/config.js` (kapcsolati e-mail, árak vagy `pricingEndpoint`). Titkos kulcs nincs a frontendben.

## Telepítés
Bármely statikus tárhely (Netlify, Cloudflare Pages, Firebase Hosting, nginx). A webmanifest/TWA a meglévő `manifest.webmanifest` alapján az app mappájába kerüljön (a feltöltésben nem volt).

## Nyitott tételek (nem kész, szándékosan nem színlelve)
1. Supabase migrációk: a meglévő séma nem volt látható (csak a használt táblák: profiles, progress, subscriptions, chart_analyses, ai_chat_usage, user_events + RPC-k). Előbb sémaexport kell, utána additív migráció.
2. Prémium árak: backendből (`pricingEndpoint`) vagy jóváhagyás után a configban. Megjegyzés: az app kódjában `PAY_CONFIG.amounts` (1990/14990 HUF) kliensoldalon szerepel, ezt érdemes backendre vinni.
3. Licencelt adat részvényekhez/indexekhez/nyersanyagokhoz/ETF-ekhez: addig DEMO. Kripto: Binance publikus API, FX: EKB napi (Frankfurter). Élő hívások sandboxból nem tesztelhetők, mockolt válaszokkal ellenőriztem.
4. Jogi oldalak tervezetek, jogi felülvizsgálat és cégadatok kellenek.
5. Az app maga (auth, terminál, akadémia) nem lett újratervezve: ez a következő szelet (lásd ütemterv a válaszban).
6. Tanfolyami időtartam, egyedi profilkép-feltöltés, jelszó-visszaállítás: az appban él, a weboldalon nincs duplikálva.

## Tesztlista
Navigáció, 3 nyelvű váltás+tartósítás, piacok (szűrés/keresés/rendezés/figyelőlista/részletek), kalkulátorok, 12 oldal 390 és 1440 px-en: nincs JS-hiba, nincs vízszintes túlcsordulás. Még hátra: 360/430/768/1024/1920 px, Lighthouse, képernyőolvasó.
