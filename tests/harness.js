// Shared test harness: stubs just enough DOM for script.js to run in Node,
// then exposes the app's internals so tests can assert on them.
//
// No dependencies. Timers are captured rather than real, so tests can assert
// on debounced and deferred behaviour without waiting.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function readApp(name) {
    return fs.readFileSync(path.join(ROOT, name), 'utf8');
}

function headScript() {
    return readApp('index.html').match(/<script>([\s\S]*?)<\/script>/)[1];
}

// Reads index.html once and records the attributes the app relies on before it
// runs: `hidden` on the emoji picker and the initial aria-* values. Without
// this the stub would claim a picker is visible when the markup hides it.
let markupDefaults = null;

function defaultsFor(id) {
    if (!markupDefaults) {
        markupDefaults = {};
        const tags = /<(?:div|span|p|button|textarea|input)\b([^>]*)>/g;
        let match;
        while ((match = tags.exec(readApp('index.html'))) !== null) {
            const attributes = match[1];
            const found = /\sid="([^"]+)"/.exec(attributes);
            if (!found) continue;
            const entry = markupDefaults[found[1]] = markupDefaults[found[1]] || {};
            if (/(^|\s)hidden(\s|$|=)/.test(attributes)) entry.hidden = true;
            for (const aria of attributes.matchAll(/(aria-[\w-]+)="([^"]*)"/g)) {
                entry[aria[1]] = aria[2];
            }
        }
    }

    return markupDefaults[id] || null;
}

function makeEl(tag, defaults) {
    const el = {
        tag,
        id: '',
        value: '',
        textContent: '',
        className: '',
        innerHTML: '',
        hidden: false,
        dataset: {},
        style: {},
        _listeners: {},
        classList: {
            _s: new Set(),
            add(c) { this._s.add(c); },
            remove(c) { this._s.delete(c); },
            contains(c) { return this._s.has(c); },
            toggle(c) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); }
        },
        addEventListener(ev, fn) {
            (this._listeners[ev] = this._listeners[ev] || []).push(fn);
        },
        click() {
            (this._listeners.click || []).forEach(fn => fn({ target: this }));
        },
        dispatch(ev, event) {
            (this._listeners[ev] || []).forEach(fn => fn(event || { target: this }));
        },
        appendChild(c) { (this._children = this._children || []).push(c); },
        contains(node) {
            const walk = el => el === node ||
                (el._children || []).some(walk);
            return walk(this);
        },
        focus() { this._focused = true; },
        select() { this._selected = true; },
        setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; },
        closest() { return null; },
        setAttribute(k, v) { this[k] = v; },
        getAttribute(k) { return this[k]; }
    };
    Object.defineProperty(el, 'selectionStart', { value: 0, writable: true });
    Object.defineProperty(el, 'selectionEnd', { value: 0, writable: true });
    // Assigning innerHTML replaces the children, as in a real DOM.
    Object.defineProperty(el, 'innerHTML', {
        get() { return el._innerHTML || ''; },
        set(value) { el._innerHTML = String(value); el._children = []; },
        configurable: true
    });
    if (defaults) {
        if (defaults.hidden) el.hidden = true;
        Object.assign(el, defaults);
    }
    return el;
}

// Internals of script.js that tests are allowed to touch.
const EXPOSED = [
    'collectIssues', 'runFix', 'updateStatistics', 'updateEmailPreview',
    'splitSentences', 'findMissingSpaceIndexes', 'addMissingSpacesInLine',
    'collapseRepeatedPunctuation', 'removeRepeatedWords',
    'fixMultipleSpaces', 'fixSpaceBeforePunctuation',
    'fixMissingSpaceAfterPunctuation', 'fixRepeatedPunctuation',
    'fixRepeatedWords', 'fixSentenceCapitalization', 'fixAllCommaCapitalization',
    'getTokenAt', 'isProtectedPeriod', 'isAcronymJoin', 'isAcronymToken',
    'isCleanToken', 'looksLikeUrlOrEmail', 'isAcronymWord', 'truncate', 'getLine',
    'parseRecipients', 'getRecipientError', 'buildEmailText',
    'saveDraft', 'loadDraft', 'scheduleDraftSave', 'clearText',
    'checkWriting', 'openEmail', 'copyEmail', 'copyText',
    'undo', 'pushUndo', 'undoStack',
    'insertEmoji', 'openEmojiPicker', 'closeEmojiPicker', 'flashButton',
    'LOWER_AFTER_COMMA', 'ALLOWED_REPEATS', 'KNOWN_ABBREVIATIONS',
    'EMAIL_PATTERN', 'FIX_ORDER', 'MAX_UNDO', 'MAILTO_MAX_LENGTH',
    'LONG_SENTENCE_WORDS', 'MAX_ISSUES_PER_RULE', 'DRAFT_SAVE_DELAY'
];

/**
 * Boot the app in a vm context.
 * @param {object} options
 * @param {object} options.preset     initial localStorage contents
 * @param {boolean} options.hostile   make every localStorage call throw
 * @param {boolean} options.skipJs    do not load script.js (head script only)
 */
function createEnv(options = {}) {
    const { preset = {}, hostile = false, skipJs = false } = options;

    const els = {};
    const store = Object.assign({}, preset);
    const clipboard = [];
    const docListeners = {};
    const winListeners = {};
    const timers = [];
    let timerId = 0;

    const storage = hostile ? {
        getItem() { throw new Error('SecurityError'); },
        setItem() { throw new Error('SecurityError'); },
        removeItem() { throw new Error('SecurityError'); }
    } : {
        getItem: k => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: k => { delete store[k]; }
    };

    const sandbox = {
        console,
        setTimeout(fn, ms) {
            const id = ++timerId;
            timers.push({ id, fn, ms: ms || 0 });
            return id;
        },
        clearTimeout(id) {
            const index = timers.findIndex(timer => timer.id === id);
            if (index !== -1) timers.splice(index, 1);
        },
        confirm: () => true,
        navigator: { clipboard: { writeText: async text => { clipboard.push(text); } } },
        localStorage: storage,
        document: {
            documentElement: makeEl('html'),
            body: makeEl('body'),
            getElementById: id => {
                if (!els[id]) els[id] = makeEl(id, defaultsFor(id));
                return els[id];
            },
            createElement: tag => makeEl(tag),
            createTextNode: text => ({ text }),
            addEventListener(ev, fn) { (docListeners[ev] = docListeners[ev] || []).push(fn); }
        },
        window: {
            location: { href: '' },
            confirm: () => true,
            addEventListener(ev, fn) { (winListeners[ev] = winListeners[ev] || []).push(fn); }
        }
    };

    vm.createContext(sandbox);

    // The inline <head> script, exactly as index.html has it.
    vm.runInContext(headScript(), sandbox, { filename: 'index.html#head' });

    const darkBeforeJs =
        sandbox.document.documentElement.classList.contains('dark-theme');

    if (!skipJs) {
        vm.runInContext(readApp('script.js'), sandbox, { filename: 'script.js' });
        vm.runInContext(
            'globalThis.api = { ' +
            EXPOSED.map(n => n + ': typeof ' + n + ' === "undefined" ? undefined : ' + n)
                .join(', ') +
            ' };',
            sandbox
        );
    }

    return {
        sandbox,
        api: sandbox.api,
        els,
        store,
        clipboard,
        darkBeforeJs,
        fire: (ev, arg) => (docListeners[ev] || []).forEach(fn => fn(arg)),
        fireWindow: (ev, arg) => (winListeners[ev] || []).forEach(fn => fn(arg)),
        setText: value => { els.textInput.value = value; },
        getText: () => els.textInput.value,
        type: value => {
            els.textInput.value = value;
            (els.textInput._listeners.input || []).forEach(fn => fn({ target: els.textInput }));
        },
        setSelection: (start, end) => {
            els.textInput.selectionStart = start;
            els.textInput.selectionEnd = end === undefined ? start : end;
        },
        // Fire every captured timer whose delay is within `withinMs`.
        runTimers(withinMs = Infinity) {
            let fired = 0;
            for (;;) {
                const due = timers
                    .filter(timer => timer.ms <= withinMs)
                    .sort((a, b) => a.ms - b.ms)[0];
                if (!due) return fired;
                timers.splice(timers.indexOf(due), 1);
                due.fn();
                fired++;
            }
        },
        pendingTimers: () => timers.length,
        stats: () => ({
            words: String(els.wordCount.textContent),
            chars: String(els.charCount.textContent),
            sentences: String(els.sentenceCount.textContent),
            paragraphs: String(els.paragraphCount.textContent)
        })
    };
}

// --------------------------------------------------------------- assertions

function createReporter(suiteName) {
    const state = { suite: suiteName, pass: 0, fail: 0, failures: [], section: '' };

    const record = (label, passed, detail) => {
        if (passed) {
            state.pass++;
        } else {
            state.fail++;
            state.failures.push({
                section: state.section,
                label,
                detail
            });
        }
    };

    return {
        state,
        section(title) {
            state.section = title;
            return title;
        },
        eq(label, actual, expected) {
            const a = JSON.stringify(actual);
            const e = JSON.stringify(expected);
            return record(label, a === e,
                'expected ' + e + '\n        actual   ' + a);
        },
        ok(label, condition) {
            return record(label, !!condition,
                'expected truthy, got ' + JSON.stringify(condition));
        },
        includes(label, haystack, needle) {
            const passed = String(haystack).includes(needle);
            return record(label, passed,
                'expected to contain ' + JSON.stringify(needle) +
                '\n        actual   ' + JSON.stringify(String(haystack).slice(0, 300)));
        },
        notIncludes(label, haystack, needle) {
            const passed = !String(haystack).includes(needle);
            return record(label, passed,
                'expected NOT to contain ' + JSON.stringify(needle) +
                '\n        actual   ' + JSON.stringify(String(haystack).slice(0, 300)));
        }
    };
}

module.exports = { createEnv, createReporter, readApp, headScript, makeEl, EXPOSED, ROOT };
