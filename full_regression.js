// full_regression.js
// Teljes regressziós ellenőrzés a Chartolj! app index.html fájljára.
// Kötelező minden módosítás után lefuttatni (lásd a scheduled task leírását):
// ellenőrzi, hogy a tartalmi adatstruktúrák (leckék, modulok, szószedet)
// változatlanok maradtak, és hogy minden inline <script> blokk szintaktikailag
// hibátlan.
//
// Használat:  node full_regression.js
// Kilépési kód 0 = minden ellenőrzés OK ("ok": true a JSON kimenetben),
// kilépési kód 1 = legalább egy ellenőrzés hibás.

const fs = require('fs');
const path = require('path');

const INDEX_PATH = path.join(__dirname, 'index.html');
const html = fs.readFileSync(INDEX_PATH, 'utf-8');

function extractBalanced(src, startMarker, openChar, closeChar) {
    const startIdx = src.indexOf(startMarker);
    if (startIdx === -1) throw new Error(`Marker not found: ${startMarker}`);
    const exprStart = src.indexOf(openChar, startIdx);
    let depth = 0, inStr = false, strChar = '', esc = false;
    for (let i = exprStart; i < src.length; i++) {
        const c = src[i];
        if (inStr) {
            if (esc) { esc = false; }
            else if (c === '\\') { esc = true; }
            else if (c === strChar) { inStr = false; }
        } else {
            if (c === '"' || c === "'" || c === '`') { inStr = true; strChar = c; }
            else if (c === openChar) depth++;
            else if (c === closeChar) {
                depth--;
                if (depth === 0) return src.slice(exprStart, i + 1);
            }
        }
    }
    throw new Error(`Unbalanced structure for marker: ${startMarker}`);
}

const results = [];
function check(name, fn) {
    try {
        const detail = fn();
        results.push({ name, ok: true, detail });
    } catch (e) {
        results.push({ name, ok: false, error: e.message });
    }
}

// 1) LESSONS_DATA — 552 lecke, 7 modul (0-6), minden leckének van cím és modul.
check('lessons_data_count_and_modules', () => {
    const src = extractBalanced(html, 'const LESSONS_DATA = ', '[', ']');
    const data = new Function('return ' + src)();
    if (!Array.isArray(data)) throw new Error('LESSONS_DATA nem tömb');
    if (data.length !== 552) throw new Error(`Várt 552 lecke, kapott ${data.length}`);
    const modules = new Set(data.map(l => l.m));
    const expectedModules = new Set([0, 1, 2, 3, 4, 5, 6]);
    if (modules.size !== 7 || [...expectedModules].some(m => !modules.has(m))) {
        throw new Error(`Várt 7 modul (0-6), kapott: ${[...modules].sort().join(',')}`);
    }
    data.forEach((l, i) => {
        if (!l.t || typeof l.t !== 'string') throw new Error(`Lecke #${i} hiányzó cím`);
        if (typeof l.m !== 'number') throw new Error(`Lecke #${i} hiányzó modul`);
    });
    return { lessonCount: data.length, moduleCount: modules.size };
});

// 2) ACADEMY_MODULES — pontosan 7 modul definíció.
check('academy_modules_count', () => {
    const src = extractBalanced(html, 'const ACADEMY_MODULES = ', '[', ']');
    const data = new Function('return ' + src)();
    if (!Array.isArray(data)) throw new Error('ACADEMY_MODULES nem tömb');
    if (data.length !== 7) throw new Error(`Várt 7 modul, kapott ${data.length}`);
    return { moduleCount: data.length };
});

// 3) GLOSSARY_TERMS — 96 szószedet-tétel.
// JAVÍTÁS (2026-11-06): korábban 98 tétel volt, de ebből 2 pár valódi
// duplikátum ("Kelly Kritérium"/"Kelly-kritérium" és kétszer "Profit
// Factor", eltérő, részben inkonzisztens definíciókkal) — ezeket egy-egy
// összevont, teljesebb definícióra egyesítettük, ezért a várt szám
// szándékosan 98-ról 96-ra csökkent (nem regresszió).
check('glossary_terms_count', () => {
    const src = extractBalanced(html, 'const GLOSSARY_TERMS = ', '[', ']');
    const data = new Function('return ' + src)();
    if (!Array.isArray(data)) throw new Error('GLOSSARY_TERMS nem tömb');
    if (data.length !== 96) throw new Error(`Várt 96 szószedet-tétel, kapott ${data.length}`);
    const terms = data.map(t => t.term.toLowerCase().replace(/[^a-z0-9áéíóöőúüű]+/g, ''));
    const dupes = terms.filter((t, i) => terms.indexOf(t) !== i);
    if (dupes.length > 0) throw new Error(`Duplikált szószedet-tétel(ek): ${[...new Set(dupes)].join(', ')}`);
    return { glossaryCount: data.length };
});

// 4) Minden inline <script> blokk szintaktikailag hibátlan (new Function).
check('inline_scripts_syntax', () => {
    const scripts = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
    if (scripts.length === 0) throw new Error('Nem található inline <script> blokk');
    let errors = [];
    scripts.forEach((s, i) => {
        try { new Function(s); } catch (e) { errors.push(`blokk #${i}: ${e.message}`); }
    });
    if (errors.length > 0) throw new Error(errors.join(' | '));
    return { scriptBlockCount: scripts.length };
});

// 5) Minden onclick="funcName(...)" hivatkozásnak van function definíciója
//    (kiszűri azokat a "funkció"-kat, amik valójában JS kulcsszavak, pl. if/for).
check('onclick_handlers_have_definitions', () => {
    const JS_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'function', 'return']);
    const calls = new Set([...html.matchAll(/onclick="([a-zA-Z_][a-zA-Z0-9_]*)\(/g)].map(m => m[1]));
    const defs = new Set([...html.matchAll(/function\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)].map(m => m[1]));
    const missing = [...calls].filter(c => !defs.has(c) && !JS_KEYWORDS.has(c));
    if (missing.length > 0) throw new Error(`Hiányzó függvény-definíciók: ${missing.join(', ')}`);
    return { onclickHandlerCount: calls.size };
});

// 6) Minden "...-modal" id-vel rendelkező HTML blokknak van megfelelő
//    openToolModal/closeToolModal hivatkozása valahol a fájlban (nincs
//    teljesen árva, soha meg nem nyitható modal).
check('modals_are_reachable', () => {
    const modalIds = [...new Set([...html.matchAll(/id="([a-zA-Z0-9-]*-modal)"/g)].map(m => m[1]))];
    const orphans = modalIds.filter(id => !html.includes(`openToolModal('${id}')`) && !html.includes(`'${id}'`));
    if (orphans.length > 0) throw new Error(`Elérhetetlen modalok: ${orphans.join(', ')}`);
    return { modalCount: modalIds.length };
});

// 7) Minden lecke "cards" és "qs" tömbje strukturálisan ép: minden kártyának
//    van cím és törzsszöveg, minden kvízkérdésnek van szövege, legalább 2,
//    egymástól eltérő opciója, a helyes válasz indexe az opciók tartományán
//    belül van, és van magyarázó szövege.
check('lessons_cards_and_quiz_integrity', () => {
    const src = extractBalanced(html, 'const LESSONS_DATA = ', '[', ']');
    const data = new Function('return ' + src)();
    const issues = [];
    data.forEach((l, li) => {
        if (!Array.isArray(l.cards) || l.cards.length === 0) {
            issues.push(`Lecke #${li} (${l.t}): nincs kártya`);
        } else {
            l.cards.forEach((c, ci) => {
                if (!c.t || !c.b) issues.push(`Lecke #${li} (${l.t}) kártya #${ci}: hiányzó cím/törzsszöveg`);
            });
        }
        if (!Array.isArray(l.qs) || l.qs.length === 0) {
            issues.push(`Lecke #${li} (${l.t}): nincs kvízkérdés`);
        } else {
            l.qs.forEach((q, qi) => {
                if (!q.q) issues.push(`Lecke #${li} (${l.t}) kérdés #${qi}: hiányzó kérdésszöveg`);
                if (!Array.isArray(q.o) || q.o.length < 2) {
                    issues.push(`Lecke #${li} (${l.t}) kérdés #${qi}: kevesebb mint 2 opció`);
                } else {
                    const norm = q.o.map(x => String(x).trim().toLowerCase());
                    const dupeIdx = norm.findIndex((x, i) => norm.indexOf(x) !== i);
                    if (dupeIdx !== -1) issues.push(`Lecke #${li} (${l.t}) kérdés #${qi}: duplikált válaszopció`);
                    if (typeof q.a !== 'number' || q.a < 0 || q.a >= q.o.length) {
                        issues.push(`Lecke #${li} (${l.t}) kérdés #${qi}: érvénytelen helyes-válasz index (a=${q.a}, opciók=${q.o.length})`);
                    }
                }
                if (!q.e) issues.push(`Lecke #${li} (${l.t}) kérdés #${qi}: hiányzó magyarázat`);
            });
        }
    });
    if (issues.length > 0) throw new Error(issues.slice(0, 20).join(' | ') + (issues.length > 20 ? ` | (+${issues.length - 20} további)` : ''));
    return { lessonsChecked: data.length };
});

// 8) A LESSON_TOOL_MAP minden "tool" hivatkozása vagy egy valóban létező
//    "...-modal" id-re mutat, vagy egy ismert chart-overlay/rajzeszköz
//    kulcsszóra (rsi/bollinger/ema/trendline/fibonacci), amit a
//    tryToolFromLesson() külön ágon kezel. A DIRECT_MODAL_TOOLS tömb minden
//    eleme is valóban létező modal id kell legyen — egy elgépelt/törölt id
//    itt néma hibát okozna (a "Próbáld ki élesben" gomb nem nyitna semmit).
check('lesson_tool_map_integrity', () => {
    const modalIds = new Set([...html.matchAll(/id="([a-zA-Z0-9-]*-modal)"/g)].map(m => m[1]));
    const chartToggleTools = new Set(['rsi', 'bollinger', 'ema', 'trendline', 'fibonacci']);

    const dmtMatch = html.match(/const DIRECT_MODAL_TOOLS = (\[[^\]]*\]);/);
    if (!dmtMatch) throw new Error('DIRECT_MODAL_TOOLS tömb nem található');
    const directModalTools = new Function('return ' + dmtMatch[1])();
    const badDirect = directModalTools.filter(t => !modalIds.has(t));
    if (badDirect.length > 0) throw new Error(`DIRECT_MODAL_TOOLS érvénytelen (nem létező modal) hivatkozás(ok): ${badDirect.join(', ')}`);

    const mapSrc = extractBalanced(html, 'const LESSON_TOOL_MAP = ', '{', '}');
    const map = new Function('return ' + mapSrc)();
    const issues = [];
    Object.keys(map).forEach(k => {
        const idx = parseInt(k, 10);
        if (!(idx >= 0 && idx <= 551)) issues.push(`Lecke-index tartományon kívül: ${k}`);
        const tool = map[k].tool;
        const valid = modalIds.has(tool) || chartToggleTools.has(tool);
        if (!valid) { issues.push(`Lecke #${k}: érvénytelen tool hivatkozás "${tool}"`); return; }
        if (tool !== 'alerts-modal' && !chartToggleTools.has(tool) && !directModalTools.includes(tool)) {
            issues.push(`Lecke #${k}: tool "${tool}" sem a DIRECT_MODAL_TOOLS-ban, sem chart-toggle nem — a tryToolFromLesson()-ben lekezeletlen maradna`);
        }
    });
    if (issues.length > 0) throw new Error(issues.join(' | '));
    return { mappedLessons: Object.keys(map).length, directModalToolCount: directModalTools.length };
});

const overallOk = results.every(r => r.ok);
console.log(JSON.stringify({ ok: overallOk, results }, null, 2));
process.exit(overallOk ? 0 : 1);
