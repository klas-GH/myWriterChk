// Structural checks over index.html, style.css and script.js. These do not
// need a DOM: they guard the contracts between the three files, and the
// accessibility and contrast rules that are easy to regress by hand.

const { readApp } = require('./harness');

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
};
