// Structural checks over index.html, style.css and script.js. These do not
// need a DOM: they guard the contracts between the three files, and the
// accessibility and contrast rules that are easy to regress by hand.

const fs = require('fs');
const path = require('path');
const { readApp, ROOT } = require('./harness');

// ------------------------------------------------------------ colour helpers

function hexToRgb(hex) {
    const value = hex.trim().replace('#', '');
    const full = value.length === 3
        ? value.split('').map(c => c + c).join('')
        : value;
    return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
}

function relativeLuminance(hex) {
    const [r, g, b] = hexToRgb(hex).map(channel => {
        const s = channel / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground, background) {
    const a = relativeLuminance(foreground);
    const b = relativeLuminance(background);
    const [light, dark] = a > b ? [a, b] : [b, a];
    return (light + 0.05) / (dark + 0.05);
}

// Strips comments, then returns the custom properties declared by a selector.
function variablesIn(css, selectorPattern) {
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const block = body.match(new RegExp(selectorPattern + '\\s*\\{([^}]*)\\}'));
    if (!block) return {};
    const vars = {};
    block[1].split(';').forEach(declaration => {
        const match = declaration.match(/(--[\w-]+)\s*:\s*([^;]+)/);
        if (match) vars[match[1]] = match[2].trim();
    });
    return vars;
}

// Reads an image's declared dimensions without decoding the pixels.
function imageSize(buffer) {
    if (buffer.slice(0, 8).toString('hex') === '89504e470d0a1a0a') {
        return {
            type: 'png',
            width: buffer.readUInt32BE(16),
            height: buffer.readUInt32BE(20)
        };
    }
    const text = buffer.toString('utf8');
    const svg = /<svg\b[^>]*\swidth="(\d+)(?:px)?"[^>]*\sheight="(\d+)(?:px)?"/.exec(text);
    if (svg) return { type: 'svg', width: Number(svg[1]), height: Number(svg[2]) };
    return { type: 'unknown', width: 0, height: 0 };
}

// Inflates a PNG's pixel data so alpha can be checked directly.
function pngPixels(buffer) {
    const zlib = require('zlib');
    let offset = 8;
    let width = 0;
    let height = 0;
    const compressed = [];
    while (offset < buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.slice(offset + 4, offset + 8).toString('ascii');
        if (type === 'IHDR') {
            width = buffer.readUInt32BE(offset + 8);
            height = buffer.readUInt32BE(offset + 12);
        }
        if (type === 'IDAT') compressed.push(buffer.slice(offset + 8, offset + 8 + length));
        offset += length + 12;
    }
    const raw = zlib.inflateSync(Buffer.concat(compressed));
    return { width, height, raw };
}

module.exports = function css(t) {
    const html = readApp('index.html');
    const css = readApp('style.css');
    const script = readApp('script.js');
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');

    // ---------------------------------------------------------------------
    t.section('stylesheet is well formed');

    t.eq('braces are balanced',
        (stripped.match(/\{/g) || []).length, (stripped.match(/\}/g) || []).length);
    t.eq('parentheses are balanced',
        (stripped.match(/\(/g) || []).length, (stripped.match(/\)/g) || []).length);
    t.eq('comments are closed', (css.match(/\/\*/g) || []).length, (css.match(/\*\//g) || []).length);
    t.eq('no empty rule blocks', /\{\s*\}/.test(stripped), false);
    t.eq('no double semicolons', /;\s*;/.test(stripped), false);
    t.eq('no !important overrides', /\!important/.test(stripped), false);
    t.eq('no leftover debug outline', /outline:\s*(red|blue|green)/i.test(stripped), false);

    // A selector may be written more than once, but only if the blocks add new
    // properties. Redefining a property makes the earlier block dead code.
    const topLevel = stripped.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
    const propertiesBySelector = new Map();

    topLevel.split('}').forEach(block => {
        const open = block.lastIndexOf('{');
        if (open === -1) return;
        const selector = block.slice(0, open).trim();
        if (!selector || selector.startsWith('@')) return;
        const properties = block.slice(open + 1).split(';')
            .map(declaration => declaration.split(':')[0].trim())
            .filter(Boolean);
        propertiesBySelector.set(selector, (propertiesBySelector.get(selector) || []).concat(properties));
    });

    t.eq('no property is silently redefined by a later block of the same selector',
        [...propertiesBySelector].filter(([, properties]) =>
            properties.length !== new Set(properties).size), []);

    // ---------------------------------------------------------------------
    t.section('theme variables are complete in both themes');

    const light = variablesIn(css, ':root');
    const dark = variablesIn(css, 'html\\.dark-theme');

    t.ok('light theme declares variables', Object.keys(light).length > 0);
    t.ok('dark theme declares variables', Object.keys(dark).length > 0);
    t.eq('dark theme overrides every light variable',
        Object.keys(light).filter(name => !(name in dark)), []);

    t.eq('every colour value is a hex colour',
        [...Object.values(light), ...Object.values(dark)]
            .filter(value => !/^#[0-9a-f]{3,8}$/i.test(value)), []);

    t.eq('the dark theme redefines the text colour on the primary',
        dark['--on-primary'] !== light['--on-primary'], true);
    t.ok('light-theme text on the primary button meets AA',
        contrast(light['--on-primary'], light['--primary-color']) >= 4.5);
    t.ok('dark-theme text on the primary button meets AA',
        contrast(dark['--on-primary'], dark['--primary-color']) >= 4.5);

    t.section('contrast (WCAG AA)');

    const pairs = {
        'body text on the page': [light['--text-dark'], light['--bg-color']],
        'body text on a panel': [light['--text-dark'], light['--panel-bg']],
        'muted text on a panel': [light['--text-muted'], light['--panel-bg']],
        'muted label in a stat box': [light['--text-muted'], light['--bg-color']],
        'primary accent on a panel': [light['--primary-color'], light['--panel-bg']],
        'success text on a stat box': [light['--success-color'], light['--bg-color']],
        'warning text on a stat box': [light['--warning-color'], light['--bg-color']],
        'error text on a stat box': [light['--error-color'], light['--bg-color']],
        'fix button label on a panel': [light['--primary-color'], light['--raised-bg']],
        'before label on a preview': [light['--error-color'], light['--raised-bg']],
        'after label on a preview': [light['--success-color'], light['--raised-bg']],
        'dark body text on the page': [dark['--text-dark'], dark['--bg-color']],
        'dark body text on a panel': [dark['--text-dark'], dark['--panel-bg']],
        'dark muted text on a panel': [dark['--text-muted'], dark['--panel-bg']],
        'dark muted label in a stat box': [dark['--text-muted'], dark['--bg-color']],
        'dark primary accent on a panel': [dark['--primary-color'], dark['--panel-bg']],
        'dark success text on a stat box': [dark['--success-color'], dark['--bg-color']],
        'dark warning text on a stat box': [dark['--warning-color'], dark['--bg-color']],
        'dark error text on a stat box': [dark['--error-color'], dark['--bg-color']],
        'dark fix button label on a panel': [dark['--primary-color'], dark['--raised-bg']],
        'dark before label on a preview': [dark['--error-color'], dark['--raised-bg']],
        'dark after label on a preview': [dark['--success-color'], dark['--raised-bg']],
        'dark ready status text': [dark['--success-color'], dark['--raised-bg-hover']],
        'light ready status text': [light['--success-color'], light['--raised-bg-hover']]
    };

    Object.entries(pairs).forEach(([label, [foreground, background]]) => {
        const ratio = contrast(foreground, background);
        t.ok(label + ': ' + ratio.toFixed(2) + ':1', ratio >= 4.5);
    });

    // ---------------------------------------------------------------------
    t.section('markup matches the script');

    const htmlIds = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
    const usedIds = [...script.matchAll(/getElementById\('([^']+)'\)/g)].map(match => match[1]);

    t.eq('element ids are unique', htmlIds.length, new Set(htmlIds).size);
    t.eq('every id the script looks up exists in the markup',
        usedIds.filter(id => !htmlIds.includes(id)), []);
    t.eq('every id in the markup is used by the script',
        htmlIds.filter(id => !usedIds.includes(id)), []);

    t.eq('the script is loaded with a relative path',
        /<script src="script\.js"><\/script>/.test(html), true);
    t.eq('the stylesheet is linked',
        /<link rel="stylesheet" href="style\.css">/.test(html), true);
    t.eq('the document declares a language', /<html lang="[a-z-]+">/i.test(html), true);
    t.eq('the viewport is responsive',
        /<meta name="viewport" content="[^"]*width=device-width/.test(html), true);
    t.eq('the charset is declared', /<meta charset="UTF-8">/i.test(html), true);
    t.eq('there is exactly one h1', (html.match(/<h1[\s>]/g) || []).length, 1);
    t.ok('headings do not skip a level',
        [...html.matchAll(/<h([1-6])[\s>]/g)].map(match => Number(match[1]))
            .every((level, i, all) => i === 0 || level <= all[i - 1] + 1));

    t.eq('every input has a label', (() => {
        const labelled = new Set(
            [...html.matchAll(/<label[^>]*\bfor="([^"]+)"/g)].map(match => match[1])
        );
        return [...html.matchAll(/<(input|textarea)\b[^>]*\bid="([^"]+)"/g)]
            .map(match => match[2])
            .filter(id => !labelled.has(id));
    })(), []);

    t.eq('every button declares its type', (() => {
        const buttons = [...html.matchAll(/<button\b([^>]*)>/g)].map(match => match[1]);
        return buttons.filter(attributes => !/\btype="/.test(attributes)).length;
    })(), 0);

    t.eq('no form control is disabled or read-only', (() => {
        const controls = [...html.matchAll(/<(?:input|textarea|button)\b([^>]*)>/g)];
        return controls
            .map(match => match[1])
            .filter(attributes => /\breadonly\b|\bdisabled\b/.test(attributes)).length;
    })(), 0);

    t.eq('the message field has no character limit', (() => {
        const textarea = /<textarea\b([^>]*)>/.exec(html);
        return textarea ? /\bmaxlength\b/.test(textarea[1]) : true;
    })(), false);

    t.eq('every button has an accessible name', (() => {
        const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
        return buttons
            .filter(([, attributes, label]) => !label.trim() && !/aria-label="/.test(attributes))
            .length;
    })(), 0);

    t.eq('the emoji picker buttons carry a data-emoji value', (() => {
        const emojis = [...html.matchAll(/data-emoji="([^"]+)"/g)].map(match => match[1]);
        return emojis.length > 0 && emojis.every(emoji => emoji.length > 0);
    })(), true);

    t.eq('aria-controls points at a real element', (() => {
        const controlled = [...html.matchAll(/aria-controls="([^"]+)"/g)].map(m => m[1]);
        return controlled.filter(id => !htmlIds.includes(id));
    })(), []);

    t.section('accessibility affordances');

    t.ok('the results region announces updates',
        /id="checkResults"[^>]*aria-live="polite"/.test(html));
    t.ok('the email status region announces updates',
        /id="emailStatus"[^>]*aria-live="polite"/.test(html));
    t.eq('the textarea has a visually hidden label', (() => {
        const label = html.match(/<label class="sr-only" for="textInput">([^<]*)</);
        return label ? label[1].trim().length > 0 : false;
    })(), true);
    t.ok('the emoji button is labelled for screen readers',
        /id="emojiBtn"[\s\S]*?aria-label="Insert emoji"/.test(html));
    t.ok('the emoji picker is a labelled group',
        /id="emojiPicker"[\s\S]*?role="group"/.test(html));
    t.eq('the picker starts hidden', /id="emojiPicker"[\s\S]*?hidden/.test(html), true);
    t.eq('the theme toggle exposes its state',
        /id="themeToggle"[\s\S]*?aria-pressed="false"/.test(html), true);
    t.ok('the theme toggle has an accessible name',
        /id="themeToggle"[\s\S]*?aria-label="Toggle dark mode"/.test(html));
    t.ok('focus is always visible', /:focus-visible\s*\{[^}]*outline:\s*2px/.test(stripped));
    t.ok('the visually hidden helper is defined', /\.sr-only\s*\{/.test(stripped));
    t.ok('invalid recipients get a visible border',
        /\.email-fields input\[aria-invalid="true"\]/.test(stripped));
    t.ok('the hidden picker is not display:block by accident',
        /\.emoji-picker\[hidden\]\s*\{\s*display:\s*none/.test(stripped));

    t.section('responsive rules');

    t.ok('a small-screen breakpoint exists',
        /@media \(max-width: 600px\)/.test(stripped));
    t.ok('a large-screen breakpoint exists',
        /@media \(min-width: 901px\)/.test(stripped));
    t.ok('the wide layout matches the container max-width', (() => {
        const container = stripped.match(/\.tool-container\s*\{[^}]*max-width:\s*(\d+)px/);
        const media = stripped.match(/@media \(min-width: (\d+)px\)[\s\S]*?\.tool-container/);
        return container && media && Number(media[1]) === Number(container[1]) + 1;
    })(), true);
    t.ok('the emoji picker is clamped to the viewport',
        /\.emoji-picker\s*\{[\s\S]*?width:\s*min\(/.test(stripped));

    t.section('no dead code');

    const declared = [
        ...script.matchAll(/^(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm)
    ].map(match => match[1]);
    const constants = [
        ...script.matchAll(/^const\s+([A-Z0-9_]+)\s*=/gm)
    ].map(match => match[1]);

    t.ok('functions were found to check', declared.length > 20);

    t.eq('no function is defined and never used',
        declared.filter(name => {
            const uses = script.match(new RegExp('\\b' + name + '\\b', 'g')) || [];
            return uses.length < 2;
        }), []);

    t.eq('no constant is defined and never used',
        constants.filter(name => {
            const uses = script.match(new RegExp('\\b' + name + '\\b', 'g')) || [];
            return uses.length < 2;
        }), []);

    t.eq('every id written into the DOM also exists in the markup', (() => {
        const created = [...script.matchAll(/className\s*=\s*'([^']+)'/g)]
            .flatMap(match => match[1].split(/\s+/))
            .filter(name => name && !name.includes('$'));
        return [...new Set(created)]
            .filter(name => !new RegExp('\\.' + name + '\\b').test(stripped))
            .filter(name => name !== 'success' && name !== 'warning' && name !== 'error' &&
                name !== 'info' && name !== 'ready');
    })(), []);

    t.eq('no console logging left behind', /console\.(log|debug|warn)\(/.test(script), false);
    t.eq('no debugger statement', /\bdebugger\b/.test(script), false);
    t.eq('no TODO or FIXME left behind', /TODO|FIXME|XXX/.test(script), false);

    // ---------------------------------------------------------------------
    t.section('installable app (PWA)');

    let manifest = null;
    let manifestError = null;
    try {
        manifest = JSON.parse(readApp('manifest.webmanifest'));
    } catch (error) {
        manifestError = error.message;
    }
    t.eq('manifest.webmanifest is valid JSON', manifestError, null);

    if (manifest) {
        ['name', 'short_name', 'start_url', 'display',
            'background_color', 'theme_color', 'icons'
        ].forEach(field => {
            t.ok('manifest has ' + field, manifest[field] !== undefined);
        });

        t.eq('short_name fits an app label',
            manifest.short_name.length <= 20, true);
        t.eq('installs as a standalone app', manifest.display, 'standalone');
        t.eq('scope covers the app root', manifest.scope, '.');
        t.eq('background matches the light theme surface',
            manifest.background_color, variablesIn(css, ':root')['--bg-color']);
        t.eq('theme matches the primary colour',
            manifest.theme_color, variablesIn(css, ':root')['--primary-color']);
        t.ok('icons are declared', Array.isArray(manifest.icons) && manifest.icons.length > 0);

        const icons = manifest.icons;
        t.ok('a 192px icon is offered',
            icons.some(icon => String(icon.sizes).includes('192')));
        t.ok('a 512px icon is offered',
            icons.some(icon => String(icon.sizes).includes('512')));
        t.ok('both maskable and ordinary icons are offered',
            ['any', 'maskable'].every(purpose =>
                icons.some(icon =>
                    (icon.purpose || 'any').split(/\s+/).includes(purpose))));
        t.ok('a vector icon is offered for crisp scaling',
            icons.some(icon => icon.sizes === 'any'));

        icons.forEach(icon => {
            const file = path.join(ROOT, icon.src);
            const exists = fs.existsSync(file);
            t.ok('icon exists: ' + icon.src, exists);
            if (!exists) return;

            const buffer = fs.readFileSync(file);
            const size = imageSize(buffer);
            t.eq(icon.src + ' is a known image type', size.type === 'unknown', false);

            if (size.type === 'png') {
                const [width, height] = String(icon.sizes).split('x').map(Number);
                t.eq(icon.src + ' matches its declared size',
                    [size.width, size.height], [width, height]);
            } else {
                t.ok(icon.src + ' is a real SVG',
                    buffer.toString('utf8').trimStart().startsWith('<svg'));
            }
        });

        // A maskable icon must fill its canvas, or the adaptive-icon
        // mask clips the corners off the artwork.
        const maskables = icons.filter(icon =>
            (icon.purpose || '').includes('maskable') &&
            icon.src.endsWith('.png') &&
            fs.existsSync(path.join(ROOT, icon.src)));
        maskables.forEach(icon => {
            const buffer = fs.readFileSync(path.join(ROOT, icon.src));
            const { width, height, raw } = pngPixels(buffer);
            const stride = width * 4;
            const alphaAt = (x, y) => raw[y * (stride + 1) + 1 + x * 4 + 3];
            const edges = [
                alphaAt(0, 0), alphaAt(width - 1, 0),
                alphaAt(0, height - 1), alphaAt(width - 1, height - 1),
                alphaAt(Math.floor(width / 2), 0),
                alphaAt(0, Math.floor(height / 2))
            ];
            t.ok(icon.src + ' is fully opaque, so the mask cannot clip it',
                edges.every(alpha => alpha === 255));
        });
    }

    t.eq('index.html links the manifest',
        /<link rel="manifest" href="manifest\.webmanifest">/.test(html), true);
    t.ok('index.html declares a theme colour',
        /<meta name="theme-color" content="#[0-9a-f]{6}">/i.test(html));
    t.eq('and it agrees with the manifest', (() => {
        const meta = /<meta name="theme-color" content="(#[0-9a-f]{6})"/i.exec(html);
        return meta ? meta[1].toLowerCase() : '';
    })(), manifest ? manifest.theme_color.toLowerCase() : '');
    t.ok('an apple touch icon is declared',
        /<link rel="apple-touch-icon" href="[^"]+">/.test(html));
    t.ok('a favicon is declared', /<link rel="icon" href="[^"]+"/.test(html));

    t.ok('script.js registers the service worker',
        /navigator\.serviceWorker\.register\('sw\.js'\)/.test(script));
    t.ok('registration is guarded so file:// still works',
        /if \('serviceWorker' in navigator\)/.test(script));
    t.ok('a registration failure is caught',
        /register\('sw\.js'\)\.catch\(/.test(script));

    t.ok('sw.js caches the app shell on install',
        /addEventListener\('install'[\s\S]*?cache\.addAll/.test(readApp('sw.js')));
    t.ok('sw.js claims clients on activate',
        /addEventListener\('activate'[\s\S]*?clients\.claim/.test(readApp('sw.js')));
    t.ok('sw.js serves from the cache first',
        /addEventListener\('fetch'[\s\S]*?caches\.match/.test(readApp('sw.js')));
    t.ok('sw.js falls back to the shell offline',
        /caches\.match\('index\.html'\)/.test(readApp('sw.js')));
    t.ok('sw.js bumps a cache version', /const CACHE = '[^']*v\d+/.test(readApp('sw.js')));

    t.ok('every shell file the worker caches exists',
        readApp('sw.js')
            .match(/SHELL = \[([\s\S]*?)\]/)[1]
            .match(/'([^']+)'/g)
            .map(entry => entry.slice(1, -1))
            .filter(entry => entry !== '.')
            .filter(entry => !fs.existsSync(path.join(ROOT, entry))));

    t.ok('light theme declares its colour scheme',
        /:root\s*\{[^}]*color-scheme:\s*light/.test(stripped));
    t.ok('dark theme declares its colour scheme',
        /html\.dark-theme\s*\{[^}]*color-scheme:\s*dark/.test(stripped));
};
