# Tailwind CSS static build

`index.html` embeds a **precompiled, static** Tailwind CSS (inside
`<style id="tailwind-compiled">`) instead of loading `cdn.tailwindcss.com`
at runtime. This was a deliberate fix: when the CDN script fails or loads
slowly (weak mobile network, firewall, ad-blocker, offline), the app used
to render with no styling at all — completely broken and "not sized to the
screen". The static CSS removes that single point of failure.

## How to rebuild after adding new classes

If you add new **static** Tailwind classes anywhere in `index.html`, no
rebuild is needed only if they're already covered; to regenerate after any
class changes:

```bash
npm install -D tailwindcss@3   # in an empty/scratch directory
npx tailwindcss -i input.css -o output.css --minify \
  -c build-tools/tailwind.config.js
```

Where `input.css` contains:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

Then replace the contents of the `<style id="tailwind-compiled">` block in
`index.html` with the new `output.css` contents.

## Dynamically-built class names (safelist)

A handful of places in the app build class names at runtime via string
interpolation (e.g. `` `bg-${accent}/10` ``, `` `text-${s.color}` ``) rather
than writing the literal class string. Tailwind's content scanner can only
see literal text in the file, so these would be silently dropped by normal
purging. `tailwind.config.js`'s `safelist` entry explicitly covers every
color token actually used this way (the `neon-*` palette, `amber-400`,
`slate-400`) across the prefixes/modifiers/opacity values actually used
(`bg-`, `text-`, `border-`, `hover:border-`, etc., `/5` through `/100`).

**If you add a new dynamically-interpolated color class**, extend the
safelist pattern in `tailwind.config.js` accordingly before rebuilding —
otherwise it will compile fine but render unstyled in production.
