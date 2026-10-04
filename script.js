// =========================
// CONSTANTS
// =========================

const STORAGE_KEYS = {
    // NOTE: 'theme' is duplicated as a literal in the inline <head> script in
    // index.html, which must run before this file loads. Change both together.
    theme: 'theme',
    draftText: 'draftText',
    draftTo: 'draftTo',
    draftSubject: 'draftSubject'
};

const MAX_ISSUES_PER_RULE = 8;
const MAX_UNDO = 50;
const MAILTO_MAX_LENGTH = 1800;
const DRAFT_SAVE_DELAY = 300;
const LONG_SENTENCE_WORDS = 30;

// Shown in the bottom-left corner as vMAJOR.MINOR. Bump the major
// part for breaking changes (2.0.0 shows "v2.0") and the minor part
// for features and fixes (1.1.0 shows "v1.1"). Keep in sync with the
// "version" field in package.json.
const APP_VERSION = '1.0.0';

const EMAIL_PATTERN = /^[^\s@,;:<>()[\]\\"]+@[^\s@,;:<>()[\]\\"]+\.[A-Za-z]{2,}$/;

// Words that are legitimately lowercase after a comma. Anything not in this
// list (proper nouns, place names, product names) is left untouched.
const LOWER_AFTER_COMMA = new Set([
    'and', 'but', 'or', 'nor', 'so', 'yet',
    'because', 'although', 'though', 'while', 'unless', 'since', 'until',
    'however', 'therefore', 'thus', 'hence', 'meanwhile', 'moreover',
    'furthermore', 'nevertheless', 'nonetheless', 'otherwise', 'instead',
    'besides', 'also', 'plus', 'meanwhile', 'whereas', 'whenever', 'wherever'
]);

// English words that are correctly written twice in a row.
const ALLOWED_REPEATS = new Set([
    'had', 'that', 'who', 'ha', 'no', 'yes', 'very', 'so', 'bye',
    'oh', 'ah', 'ah', 'hm', 'hmm', 'mm', 'mhm', 'well', 'hey', 'boo'
]);

// Tokens whose internal punctuation must never be rewritten.
const KNOWN_ABBREVIATIONS = new Set([
    'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc',
    'approx', 'no', 'fig', 'dept', 'inc', 'ltd', 'co', 'corp', 'est',
    'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept',
    'oct', 'nov', 'dec', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'
]);

// Order in which automatic fixes are applied by "Fix All".
const FIX_ORDER = [
    'spaces',
    'punctuationSpace',
    'missingSpace',
    'repeatedPunctuation',
    'repeatedWords',
    'sentenceCapitalization',
    'commaCapitalization'
];

const FIX_LABELS = {
    spaces: 'multiple spaces',
    punctuationSpace: 'space before punctuation',
    missingSpace: 'missing space after punctuation',
    repeatedPunctuation: 'repeated punctuation',
    repeatedWords: 'repeated words',
    sentenceCapitalization: 'sentence capitalization',
    commaCapitalization: 'capitalization after comma'
};


// =========================
// DOM REFERENCES
// =========================

const textInput = document.getElementById('textInput');

const wordCountDisplay = document.getElementById('wordCount');
const charCountDisplay = document.getElementById('charCount');
const sentenceCountDisplay = document.getElementById('sentenceCount');
const paragraphCountDisplay = document.getElementById('paragraphCount');

const copyBtn = document.getElementById('copyBtn');
const checkBtn = document.getElementById('checkBtn');
const clearBtn = document.getElementById('clearBtn');

const checkResults = document.getElementById('checkResults');
const issueCountDisplay = document.getElementById('issueCount');

const emailTo = document.getElementById('emailTo');
const emailSubject = document.getElementById('emailSubject');
const emailBtn = document.getElementById('emailBtn');

const previewTo = document.getElementById('previewTo');
const previewSubject = document.getElementById('previewSubject');
const previewBody = document.getElementById('previewBody');
const emailReadyStatus = document.getElementById('emailReadyStatus');
const emailStatus = document.getElementById('emailStatus');
const copyEmailBtn = document.getElementById('copyEmailBtn');

const emojiBtn = document.getElementById('emojiBtn');
const emojiToolbar = document.getElementById('emojiToolbar');
const emojiPicker = document.getElementById('emojiPicker');

const themeToggle = document.getElementById('themeToggle');

const appVersionDisplay = document.getElementById('appVersion');

const undoStack = [];

let draftSaveTimer = null;


// =========================
// THEME
// =========================

function isDarkTheme() {
    return document.documentElement.classList.contains('dark-theme');
}

function updateThemeButton() {
    themeToggle.textContent = isDarkTheme() ? '☀️' : '🌙';
    themeToggle.setAttribute('aria-pressed', String(isDarkTheme()));
}

themeToggle.addEventListener('click', () => {

    document.documentElement.classList.toggle('dark-theme');

    const isDark = isDarkTheme();

    try {
        localStorage.setItem(STORAGE_KEYS.theme, isDark ? 'dark' : 'light');
    } catch (error) {
        // Storage unavailable (private mode / file:// restrictions).
    }

    updateThemeButton();
});

updateThemeButton();


// =========================
// TEXT HELPERS
// =========================

function isLetter(character) {
    return typeof character === 'string' && /[\p{L}]/u.test(character);
}

function isDigit(character) {
    return typeof character === 'string' && /[0-9]/.test(character);
}

function isWhitespaceChar(character) {
    return character === ' ' || character === '\t' || character === '\n' ||
        character === '\r' || character === '\f' || character === '\v';
}

function truncate(value, max = 90, collapseWhitespace = true) {
    let text = String(value);

    if (collapseWhitespace) {
        text = text.replace(/\s+/g, ' ').trim();
    } else {
        text = text.trim();
    }

    return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

// Returns the full line containing `index`, without the line break.
function getLine(text, index) {
    const start = text.lastIndexOf('\n', index - 1) + 1;
    let end = text.indexOf('\n', index);
    if (end === -1) end = text.length;

    let line = text.slice(start, end);

    if (line.endsWith('\r')) {
        line = line.slice(0, -1);
    }

    return line;
}

// Bounded so a single huge token (a pasted blob, a long URL) cannot make
// every check scan the whole string. Real domains and acronyms are far
// shorter than this.
const MAX_TOKEN_SCAN = 200;

// Returns the whitespace-delimited token containing `index`,
// together with its offsets in `text`.
function getTokenAt(text, index) {
    const backLimit = Math.max(0, index - MAX_TOKEN_SCAN);
    const forwardLimit = Math.min(text.length, index + MAX_TOKEN_SCAN + 1);

    let start = index;
    while (start > backLimit && !isWhitespaceChar(text[start - 1])) start--;

    let end = index + 1;
    while (end < forwardLimit && !isWhitespaceChar(text[end])) end++;

    return { start, end, value: text.slice(start, end) };
}

function linePreview(text, index, transform) {
    const before = getLine(text, index);
    return { before, after: transform(before) };
}

function linePreviewForWord(text, index, word, replacement) {
    const line = getLine(text, index);
    const lineStart = text.lastIndexOf('\n', index - 1) + 1;
    const lineIndex = index - lineStart;
    return {
        before: line,
        after: replaceWordAtIndex(line, lineIndex, word, replacement)
    };
}

function replaceWordAtIndex(text, index, word, replacement) {
    return (
        text.slice(0, index) +
        replacement +
        text.slice(index + word.length)
    );
}

// =========================
// PUNCTUATION SAFETY
// =========================

// A domain run, optionally preceded by a capitalised word:
// "www.foo.co.uk", "ex.ample.com", "That.www.foo.co.uk"
function looksLikeUrlOrEmail(token) {
    // Ignore punctuation that merely follows the token.
    const value = stripTrailingPunctuation(token);

    if (/^(?:https?|ftp|file):\/\//i.test(value)) return true;
    if (/^www\./i.test(value)) return true;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return true;
    if (value.includes('/')) return true;

    return /^(?:\p{Lu}[a-z0-9-]*\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}/u.test(value);
}

// Tokens built only from ordinary word / URL characters.
// Anything messier (stray quotes, brackets, stacked punctuation) is ambiguous,
// so it is left alone rather than risking damage to it.
const CLEAN_TOKEN = /^[\p{L}\p{N}'’@._~#:/+\-$€£¥]+$/u;

function isCleanToken(value) {
    return CLEAN_TOKEN.test(stripEdgePunctuation(value));
}

// Punctuation that merely surrounds a token.
const EDGE_PUNCTUATION_CHARS = new Set([
    ',', ';', ':', '.', '!', '?', '(', ')', '[', ']', '{', '}',
    '\'', '"', '\u2018', '\u2019', '\u201C', '\u201D', '<', '>'
]);

// Walks the trailing run instead of scanning with a regex, which would be
// quadratic on long dotted tokens.
function stripTrailingPunctuation(value) {
    let end = value.length;

    while (end > 0 && EDGE_PUNCTUATION_CHARS.has(value[end - 1])) {
        end--;
    }

    return end === value.length ? value : value.slice(0, end);
}

// Used only for the "is this token safe to rewrite?" test, so that a word in
// quotes — said "no". she left — still counts as ordinary text.
function stripEdgePunctuation(value) {
    let start = 0;
    let end = value.length;

    while (end > start && EDGE_PUNCTUATION_CHARS.has(value[end - 1])) end--;
    while (start < end && EDGE_PUNCTUATION_CHARS.has(value[start])) start++;

    return value.slice(start, end);
}

// A dotted token whose every segment is a single letter: U.S.A, e.g, i.e
function isAcronymToken(value) {
    const core = stripTrailingPunctuation(value).replace(/\.+$/u, '');

    if (core.length < 3) return false;
    if (core[0] === '.') return false;

    let hasDot = false;

    for (let i = 0; i < core.length; i++) {

        const character = core[i];

        if (character === '.') {
            hasDot = true;
            continue;
        }

        // Two letters in a row means this is not an acronym.
        if (i > 0 && core[i - 1] !== '.') return false;
    }

    return hasDot;
}

// A period sitting between two single-letter segments — "U.S.A", "e.g",
// and also "thanks...U.S.A.very", where the acronym is only part of a
// larger dotted run.
function isAcronymJoin(text, index) {
    const previous = text[index - 1];
    const next = text[index + 1];

    if (!isLetter(previous) || !isLetter(next)) return false;

    // Both sides must be complete single-letter segments.
    if (index >= 2 && isLetter(text[index - 2])) return false;
    if (isLetter(text[index + 2])) return false;

    return true;
}

// "e.g. this" — a single-letter word that belongs to an acronym must not be
// treated as a sentence start.
function isAcronymWord(text, wordStart, wordEnd) {
    if (wordEnd - wordStart !== 1) return false;
    if (wordEnd >= text.length || text[wordEnd] !== '.') return false;
    if (wordStart > 0 && isLetter(text[wordStart - 1])) return false;

    return isAcronymJoin(text, wordEnd);
}

// A period that must not be treated as a missing space or a sentence end.
function isProtectedPeriod(text, index) {
    const previous = text[index - 1];
    const next = text[index + 1];

    // Ellipsis or run of dots.
    if (previous === '.') return true;

    // Decimal number: 3.14
    if (isDigit(previous) && isDigit(next)) return true;

    const token = getTokenAt(text, index);
    const core = stripTrailingPunctuation(token.value);
    const offset = index - token.start;

    // A messy token is ambiguous — leave it untouched.
    if (!isCleanToken(core)) return true;

    // An acronym continues with capitals: "U.S.A", "thanks...U.S.A.very"
    if (isAcronymJoin(text, index)) return true;
    if (isAcronymToken(core)) return true;

    // A capital right after the period means a new sentence rather than a
    // continuation of a domain: "ex.ample.com.Then"
    if (/^\p{Lu}/u.test(core.slice(offset + 1))) return false;

    if (looksLikeUrlOrEmail(core)) return true;

    // Known abbreviation right before the period: "No.5", "St.Patrick"
    const before = core.slice(0, offset);
    const segment = /[\p{L}]+$/u.exec(before);

    if (!segment) return false;

    const word = segment[0];

    // Abbreviations are capitalised. A lowercase match is a quoted word
    // such as: said "no". she left
    if (word.charAt(0) !== word.charAt(0).toUpperCase()) return false;

    return KNOWN_ABBREVIATIONS.has(word.toLowerCase());
}

// Punctuation characters that should be followed by a space.
const SPACE_AFTER_PATTERN = /[.!?,;:]/;

function findMissingSpaceIndexes(text) {
    const indexes = [];

    for (let i = 1; i < text.length - 1; i++) {

        if (!SPACE_AFTER_PATTERN.test(text[i])) continue;

        const next = text[i + 1];
        const previous = text[i - 1];

        if (!isLetter(next)) continue;
        if (/\s/.test(previous)) continue;

        // Only a period is ambiguous. Everything else
        // (! ? , ; :) touching a letter is a real mistake.
        if (text[i] === '.' && isProtectedPeriod(text, i)) continue;

        indexes.push(i);
    }

    return indexes;
}


// =========================
// SENTENCES
// =========================

// Splits on sentence-ending punctuation, but only when what follows looks
// like the start of a new sentence. This keeps "e.g. this" and "3.14" intact.
function splitSentences(text) {
    const pattern = /[.!?]+["')\]]*(\s+|$)/gu;
    const parts = [];

    let last = 0;
    let match;

    while ((match = pattern.exec(text)) !== null) {

        const separatorEnd = match.index + match[0].length;
        const rest = text.slice(separatorEnd);

        const isBoundary = match[1] === '' || /^\s*["'(\p{Lu}]/u.test(rest);

        if (!isBoundary) continue;

        parts.push(text.slice(last, match.index));
        last = separatorEnd;
    }

    parts.push(text.slice(last));

    return parts
        .map(part => part.trim())
        .filter(part => part.length > 0);
}


// =========================
// ISSUE COLLECTORS
// =========================

function pushOverflow(issues, total, label) {
    if (total <= MAX_ISSUES_PER_RULE) return;

    const hidden = total - MAX_ISSUES_PER_RULE;

    issues.push({
        severity: 'info',
        message: `…and ${hidden} more ${label} issue${hidden === 1 ? '' : 's'} not listed.`,
        preview: null,
        fix: null,
        fixKey: null
    });
}

function collectMultipleSpaces(text, issues, addFixable) {
    const pattern = /[ \t]{2,}/g;
    let total = 0;
    let match;

    while ((match = pattern.exec(text)) !== null) {
        total++;
        if (total > MAX_ISSUES_PER_RULE) break;

        issues.push({
            severity: 'warning',
            message: `Multiple spaces: "${truncate(getLine(text, match.index), 90, false)}"`,
            preview: linePreview(
                text,
                match.index,
                line => line.replace(/[ \t]{2,}/g, ' ')
            ),
            fix: fixMultipleSpaces,
            fixKey: 'spaces'
        });
    }

    if (total > 0) {
        addFixable('spaces');
        pushOverflow(issues, total, 'multiple spaces');
    }
}

function collectSpaceBeforePunctuation(text, issues, addFixable) {
    const pattern = /[ \t]+([,.!?;:])/g;
    let total = 0;
    let match;

    while ((match = pattern.exec(text)) !== null) {
        total++;
        if (total > MAX_ISSUES_PER_RULE) break;

        issues.push({
            severity: 'warning',
            message: `Space before punctuation: "${truncate(getLine(text, match.index))}"`,
            preview: linePreview(
                text,
                match.index,
                line => line.replace(/[ \t]+([,.!?;:])/g, '$1')
            ),
            fix: fixSpaceBeforePunctuation,
            fixKey: 'punctuationSpace'
        });
    }

    if (total > 0) {
        addFixable('punctuationSpace');
        pushOverflow(issues, total, 'space before punctuation');
    }
}

function collectMissingSpaces(text, issues, addFixable) {
    const indexes = findMissingSpaceIndexes(text);
    const total = indexes.length;

    indexes.slice(0, MAX_ISSUES_PER_RULE).forEach(index => {
        issues.push({
            severity: 'warning',
            message: `Missing space after "${text[index]}": "${truncate(getLine(text, index))}"`,
            preview: linePreview(text, index, addMissingSpacesInLine),
            fix: fixMissingSpaceAfterPunctuation,
            fixKey: 'missingSpace'
        });
    });

    if (total > 0) {
        addFixable('missingSpace');
        pushOverflow(issues, total, 'missing space');
    }
}

function collectRepeatedPunctuation(text, issues, addFixable) {
    const pattern = /!{2,}|\?{2,}|\.{4,}/g;
    let total = 0;
    let match;

    while ((match = pattern.exec(text)) !== null) {
        total++;
        if (total > MAX_ISSUES_PER_RULE) break;

        issues.push({
            severity: 'warning',
            message: `Repeated punctuation: "${truncate(getLine(text, match.index))}"`,
            preview: linePreview(text, match.index, collapseRepeatedPunctuation),
            fix: fixRepeatedPunctuation,
            fixKey: 'repeatedPunctuation'
        });
    }

    if (total > 0) {
        addFixable('repeatedPunctuation');
        pushOverflow(issues, total, 'repeated punctuation');
    }
}

function collectRepeatedWords(text, issues, addFixable) {
    const pattern = /\b([\p{L}']+)\s+\1\b/giu;
    let total = 0;
    let match;

    while ((match = pattern.exec(text)) !== null) {

        const word = match[1];

        if (ALLOWED_REPEATS.has(word.toLowerCase())) continue;

        total++;
        if (total > MAX_ISSUES_PER_RULE) break;

        issues.push({
            severity: 'warning',
            message: `Repeated word: "${truncate(getLine(text, match.index))}"`,
            preview: linePreview(text, match.index, removeRepeatedWords),
            fix: fixRepeatedWords,
            fixKey: 'repeatedWords'
        });
    }

    if (total > 0) {
        addFixable('repeatedWords');
        pushOverflow(issues, total, 'repeated word');
    }
}


function collectSentenceCapitalization(text, issues, addFixable) {
    const pattern = /(^[ \t]*|[.!?]["')\]]?[ \t]+)([\p{Ll}][\p{L}']*)/gmu;
    let total = 0;
    let match;

    while ((match = pattern.exec(text)) !== null) {

        const word = match[2];
        const wordStart = match.index + match[1].length;

        // "e.g. this" is not a lowercase sentence start.
        if (isAcronymWord(text, wordStart, wordStart + word.length)) continue;

        // A protected period ("e.g.", "U.S.") does not end a sentence.
        if (/^[.!?]/.test(match[1]) && isProtectedPeriod(text, match.index)) continue;

        total++;
        if (total > MAX_ISSUES_PER_RULE) break;

        const line = getLine(text, wordStart);

        // Position of the word inside its line.
        const lineStart = text.lastIndexOf('\n', wordStart - 1) + 1;
        const lineIndex = wordStart - lineStart;

        const after =
            line.slice(0, lineIndex) +
            capitalize(word) +
            line.slice(lineIndex + word.length);

        issues.push({
            severity: 'warning',
            message: `"${word}" should probably start with a capital letter.`,

            preview: {
                before: line,
                after
            },

            // Store THIS occurrence's exact position.
            fix: () => fixSpecificSentenceWordAt(word, wordStart),

            fixKey: 'sentenceCapitalization'
        });
    }

    if (total > 0) {
        addFixable('sentenceCapitalization');
        pushOverflow(issues, total, 'capitalization');
    }
}


function collectCommaCapitalization(text, issues, addFixable) {
    const pattern = /,\s+(\p{Lu}\p{Ll}+)/gu;
    let total = 0;
    let match;

    while ((match = pattern.exec(text)) !== null) {

        const word = match[1];

        // Only flag words that are genuinely wrong after a comma.
        // Proper nouns, place names and brand names are left alone.
        if (!LOWER_AFTER_COMMA.has(word.toLowerCase())) continue;

        const wordStart = match.index + match[0].length - word.length;

        total++;
        if (total > MAX_ISSUES_PER_RULE) break;

        issues.push({
            severity: 'warning',
            message: `"${word}" after a comma should probably be lowercase.`,
            preview: linePreviewForWord(text, wordStart, word, word.toLowerCase()),
            fix: () => fixSpecificCommaWordAt(wordStart, word),
            fixKey: 'commaCapitalization'
        });
    }

    if (total > 0) {
        addFixable('commaCapitalization');
        pushOverflow(issues, total, 'capitalization after comma');
    }
}

function collectLongSentences(text, issues) {
    splitSentences(text).forEach(sentence => {

        const wordCount = (sentence.match(/\S+/g) || []).length;

        if (wordCount <= LONG_SENTENCE_WORDS) return;

        issues.push({
            severity: 'warning',
            message: `Long sentence (${wordCount} words): "${truncate(sentence, 90)}" — consider splitting it manually.`,
            preview: null,
            fix: null,
            fixKey: null
        });
    });
}


// =========================
// CHECK
// =========================

function sortFixKeys(keys) {
    const wanted = new Set(keys);
    return FIX_ORDER.filter(key => wanted.has(key));
}

function collectIssues(text) {
    const issues = [];
    const fixKeys = [];

    const addFixable = key => {
        if (!fixKeys.includes(key)) fixKeys.push(key);
    };

    collectMultipleSpaces(text, issues, addFixable);
    collectSpaceBeforePunctuation(text, issues, addFixable);
    collectMissingSpaces(text, issues, addFixable);
    collectRepeatedPunctuation(text, issues, addFixable);
    collectRepeatedWords(text, issues, addFixable);
    collectSentenceCapitalization(text, issues, addFixable);
    collectCommaCapitalization(text, issues, addFixable);
    collectLongSentences(text, issues);

    // Overflow notes are not real issues.
    const realIssues = issues.filter(issue => issue.severity !== 'info');

    return {
        issues,
        total: realIssues.length,
        fixKeys: sortFixKeys(fixKeys)
    };
}

function checkWriting() {

    const text = textInput.value.trim();

    checkResults.innerHTML = '';

    if (!text) {
        issueCountDisplay.textContent = '';
        addCheckResult('warning', 'Enter some text first.');
        return;
    }

    const { issues, total, fixKeys } = collectIssues(text);

    if (total === 0) {

        issueCountDisplay.textContent = '✓ No issues';

        addCheckResult('success', 'No obvious writing issues were detected.');

    } else {

        issueCountDisplay.textContent =
            `${total} ${total === 1 ? 'issue' : 'issues'}`;

        issues.forEach(issue => addCheckResult(
            issue.severity,
            issue.message,
            issue.fix ? 'Fix' : null,
            issue.fix,
            issue.preview
        ));

        addFixAllButton(fixKeys);
    }

    addUndoButton();
}


// =========================
// RESULT UI
// =========================

function addPreview(result, beforeText, afterText) {
    const preview = document.createElement('div');
    preview.className = 'fix-preview';

    const beforeLine = document.createElement('div');
    const afterLine = document.createElement('div');

    const beforeLabel = document.createElement('strong');
    const afterLabel = document.createElement('strong');

    beforeLabel.textContent = 'Before: ';
    afterLabel.textContent = 'After: ';

    beforeLine.appendChild(beforeLabel);
    beforeLine.appendChild(document.createTextNode(beforeText));

    afterLine.appendChild(afterLabel);
    afterLine.appendChild(document.createTextNode(afterText));

    beforeLine.style.whiteSpace = 'pre-wrap';
    afterLine.style.whiteSpace = 'pre-wrap';

    preview.appendChild(beforeLine);
    preview.appendChild(afterLine);

    result.appendChild(preview);
}

function addCheckResult(
    type,
    message,
    buttonText = null,
    fixFunction = null,
    preview = null
) {
    const result = document.createElement('div');
    result.className = `check-item ${type}`;

    const messageElement = document.createElement('span');
    messageElement.textContent = message;
    messageElement.style.whiteSpace = 'pre-wrap';

    result.appendChild(messageElement);

    if (preview) {
        addPreview(result, preview.before, preview.after);
    }

    if (buttonText && fixFunction) {

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'fix-btn';
        button.textContent = buttonText;

        button.addEventListener('click', () => applyFix(fixFunction));

        result.appendChild(button);
    }

    checkResults.appendChild(result);
}

function addFixAllButton(fixKeys) {
    if (!fixKeys.length) return;

    const actions = document.createElement('div');
    actions.className = 'check-actions';

    const fixAllButton = document.createElement('button');

    fixAllButton.type = 'button';
    fixAllButton.className = 'fix-all-btn';
    fixAllButton.textContent = `Fix All Safe Issues (${fixKeys.length})`;
    fixAllButton.title = fixKeys
        .map(key => FIX_LABELS[key])
        .join(', ');

    fixAllButton.addEventListener('click', () => {

        if (!confirmFixAll(fixKeys)) return;

        pushUndo();

        fixKeys.forEach(key => runFix(key));

        updateStatistics();
        updateEmailPreview();
        saveDraft();
        checkWriting();
    });

    actions.appendChild(fixAllButton);

    checkResults.appendChild(actions);
}

function confirmFixAll(fixKeys) {
    const labels = fixKeys
        .map(key => FIX_LABELS[key])
        .join(', ');

    return window.confirm(
        `Fix all safe issues?\n\n${labels}\n\nYou can undo this afterwards.`
    );
}

function addUndoButton() {
    if (!undoStack.length) return;

    const undoButton = document.createElement('button');

    undoButton.type = 'button';
    undoButton.className = 'undo-btn';
    undoButton.textContent = `Undo (${undoStack.length})`;

    undoButton.addEventListener('click', undo);

    checkResults.appendChild(undoButton);
}


// =========================
// FIX FUNCTIONS
// =========================

function capitalize(word) {
    return word.charAt(0).toUpperCase() + word.slice(1);
}

function applyFix(fixFunction) {
    pushUndo();
    fixFunction();
    updateStatistics();
    updateEmailPreview();
    saveDraft();
    checkWriting();
}

function pushUndo() {
    undoStack.push(textInput.value);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
}

function undo() {
    const previous = undoStack.pop();

    if (previous === undefined) return;

    textInput.value = previous;

    updateStatistics();
    updateEmailPreview();
    saveDraft();
    checkWriting();
}

function runFix(key) {
    switch (key) {
        case 'spaces':
            fixMultipleSpaces();
            break;
        case 'punctuationSpace':
            fixSpaceBeforePunctuation();
            break;
        case 'missingSpace':
            fixMissingSpaceAfterPunctuation();
            break;
        case 'repeatedPunctuation':
            fixRepeatedPunctuation();
            break;
        case 'repeatedWords':
            fixRepeatedWords();
            break;
        case 'sentenceCapitalization':
            fixSentenceCapitalization();
            break;
        case 'commaCapitalization':
            fixAllCommaCapitalization();
            break;
        default:
            break;
    }
}

// "Hello  John" -> "Hello John"
function fixMultipleSpaces() {
    textInput.value = textInput.value.replace(/[ \t]{2,}/g, ' ');
}

// "Hello , world" -> "Hello, world"
function fixSpaceBeforePunctuation() {
    textInput.value = textInput.value.replace(/[ \t]+([,.!?;:])/g, '$1');
}

function addMissingSpacesInLine(line) {
    const indexes = findMissingSpaceIndexes(line);
    let result = '';
    let last = 0;

    indexes.forEach(index => {
        result += line.slice(last, index + 1) + ' ';
        last = index + 1;
    });

    return result + line.slice(last);
}

// "Hi John,How are you?" -> "Hi John, How are you?"
function fixMissingSpaceAfterPunctuation() {
    textInput.value = addMissingSpacesInLine(textInput.value);
}

function collapseRepeatedPunctuation(line) {
    return line
        .replace(/!{2,}/g, '!')
        .replace(/\?{2,}/g, '?')
        .replace(/\.{4,}/g, '...');
}

// "Really!!" -> "Really!"
function fixRepeatedPunctuation() {
    textInput.value = collapseRepeatedPunctuation(textInput.value);
}

function removeRepeatedWords(line) {
    const pattern = /\b([\p{L}']+)\s+\1\b/giu;
    let result = '';
    let last = 0;
    let match;

    while ((match = pattern.exec(line)) !== null) {

        if (ALLOWED_REPEATS.has(match[1].toLowerCase())) continue;

        result += line.slice(last, match.index) + match[1];
        last = match.index + match[0].length;
    }

    return result + line.slice(last);
}

// "This is is a test." -> "This is a test."
function fixRepeatedWords() {
    textInput.value = removeRepeatedWords(textInput.value);
}

// "hello world. this is a test." -> "Hello world. This is a test."
function fixSentenceCapitalization() {
    const text = textInput.value;

    textInput.value = text.replace(
        /(^[ \t]*|[.!?]["')\]]?[ \t]+)([\p{Ll}])/gmu,
        (match, prefix, letter, offset) => {

            // Skip protected periods such as "e.g." and "U.S."
            if (/^[.!?]/.test(prefix) && isProtectedPeriod(text, offset)) return match;

            const wordStart = offset + prefix.length;

            if (isAcronymWord(text, wordStart, wordStart + 1)) return match;

            return prefix + letter.toUpperCase();
        }
    );
}

function fixSpecificSentenceWordAt(word, start) {
    const text = textInput.value;

    // Safety check: don't modify a different word if the text changed.
    if (text.slice(start, start + word.length) !== word) {
        return;
    }

    textInput.value =
        text.slice(0, start) +
        capitalize(word) +
        text.slice(start + word.length);
}




function fixSpecificCommaWordAt(start, word) {
    const text = textInput.value;

    // Make sure the stored location still contains the
    // word that was originally detected.
    if (text.slice(start, start + word.length) !== word) {
        return;
    }

    textInput.value =
        text.slice(0, start) +
        word.toLowerCase() +
        text.slice(start + word.length);
}


// Only lowercases words that are known to be wrong after a comma.
function fixAllCommaCapitalization() {
    textInput.value = textInput.value.replace(
        /,\s+(\p{Lu}\p{Ll}+)/gu,
        (match, word) => {
            if (!LOWER_AFTER_COMMA.has(word.toLowerCase())) return match;

            return match.slice(0, match.length - word.length) + word.toLowerCase();
        }
    );
}


// =========================
// STATISTICS
// =========================

function updateStatistics() {
    const text = textInput.value;

    charCountDisplay.textContent = text.length;

    wordCountDisplay.textContent = (text.match(/\S+/g) || []).length;

    sentenceCountDisplay.textContent = splitSentences(text).length;

    paragraphCountDisplay.textContent = text
        .split(/\n+/)
        .filter(paragraph => paragraph.trim().length > 0)
        .length;
}


// =========================
// EMOJI
// =========================

function openEmojiPicker() {
    emojiPicker.hidden = false;
    emojiBtn.setAttribute('aria-expanded', 'true');
}

function closeEmojiPicker() {
    emojiPicker.hidden = true;
    emojiBtn.setAttribute('aria-expanded', 'false');
}

function insertEmoji(emoji) {
    const start = textInput.selectionStart;
    const end = textInput.selectionEnd;
    const text = textInput.value;

    textInput.value = text.slice(0, start) + emoji + text.slice(end);

    const cursor = start + emoji.length;

    textInput.focus();
    textInput.setSelectionRange(cursor, cursor);

    updateStatistics();
    updateEmailPreview();
    saveDraft();

    closeEmojiPicker();
}


// =========================
// COPY
// =========================

async function copyText() {

    if (!textInput.value.trim()) {
        flashButton(copyBtn, 'Nothing to copy', 'Copy Text');
        return;
    }

    try {
        await navigator.clipboard.writeText(textInput.value);
        flashButton(copyBtn, 'Copied!', 'Copy Text');
    } catch (error) {
        flashButton(copyBtn, 'Copy Failed', 'Copy Text');
    }
}

function flashButton(button, temporaryText, originalText) {
    button.textContent = temporaryText;

    setTimeout(() => {
        button.textContent = originalText;
    }, 1500);
}

function buildEmailText() {
    const recipients = parseRecipients(emailTo.value);
    const subject = emailSubject.value.trim();
    const body = textInput.value.trim();

    return [
        `To: ${recipients.join(', ')}`,
        `Subject: ${subject || '(No subject)'}`,
        '',
        body
    ].join('\n');
}

async function copyEmail() {

    const recipients = parseRecipients(emailTo.value);
    const body = textInput.value.trim();

    const recipientError = getRecipientError(recipients);

    if (recipientError) {
        setEmailStatus(recipientError, 'error');
        emailTo.focus();
        return;
    }

    if (!body) {
        setEmailStatus('Please enter a message first.', 'error');
        textInput.focus();
        return;
    }

    try {
        await navigator.clipboard.writeText(buildEmailText());

        flashButton(copyEmailBtn, 'Copied!', 'Copy Email');
        setEmailStatus('Email copied to clipboard.', 'success');
    } catch (error) {
        setEmailStatus('Could not copy the email. Select the text and copy manually.', 'error');
    }
}


// =========================
// EMAIL
// =========================

function parseRecipients(value) {
    return value
        .split(/[,;]/)
        .map(part => part.trim())
        .filter(part => part.length > 0);
}

function getRecipientError(recipients) {
    if (!recipients.length) {
        return 'Please enter a recipient email address.';
    }

    const invalid = recipients.filter(recipient => !EMAIL_PATTERN.test(recipient));

    if (invalid.length) {
        return `Invalid email address${invalid.length === 1 ? '' : 'es'}: ${invalid.join(', ')}`;
    }

    return null;
}

function setEmailStatus(message, type) {
    emailStatus.textContent = message;
    emailStatus.className = `email-status ${type || ''}`.trim();
}

function updateEmailPreview() {
    const recipientValue = emailTo.value.trim();
    const subject = emailSubject.value.trim();
    const body = textInput.value.trim();

    const recipients = parseRecipients(recipientValue);
    const recipientError = getRecipientError(recipients);

    previewTo.textContent = recipientValue || '—';
    previewSubject.textContent = subject || '—';
    previewBody.textContent = body || 'Your message will appear here.';

    emailTo.setAttribute('aria-invalid', String(Boolean(recipientError)));

    const isReady = Boolean(body) && !recipientError;

    if (isReady) {
        emailReadyStatus.textContent = 'Ready to send';
        emailReadyStatus.classList.add('ready');
        emailBtn.classList.add('ready');
        emailBtn.textContent = 'Open in Email';
    } else {
        emailReadyStatus.textContent = recipientError
            ? 'Check the recipient address'
            : 'Ready to review';
        emailReadyStatus.classList.remove('ready');
        emailBtn.classList.remove('ready');
        emailBtn.textContent = 'Open in Email';
    }
}

function openEmail() {

    const recipients = parseRecipients(emailTo.value);
    const subject = emailSubject.value.trim();
    const body = textInput.value.trim();

    setEmailStatus('');

    const recipientError = getRecipientError(recipients);

    if (recipientError) {
        setEmailStatus(recipientError, 'error');
        emailTo.focus();
        return;
    }

    if (!body) {
        setEmailStatus('Please enter a message first.', 'error');
        textInput.focus();
        return;
    }

    // Recipients are validated above, so they are safe to place in the URL
    // unencoded — this keeps "@" readable and allows multiple recipients.
    const mailtoUrl =
        `mailto:${recipients.join(',')}` +
        `?subject=${encodeURIComponent(subject)}` +
        `&body=${encodeURIComponent(body).replace(/%0A/g, '%0D%0A')}`;

    if (mailtoUrl.length > MAILTO_MAX_LENGTH) {
        setEmailStatus(
            `This message is too long for a mail link (${mailtoUrl.length} characters, limit ${MAILTO_MAX_LENGTH}). Your mail app may cut it off — use "Copy Email" instead.`,
            'error'
        );
        return;
    }

    window.location.href = mailtoUrl;
}


// =========================
// CLEAR
// =========================

function clearText() {
    textInput.value = '';

    undoStack.length = 0;

    issueCountDisplay.textContent = '';

    checkResults.innerHTML = '';

    const empty = document.createElement('p');
    empty.className = 'check-empty';
    empty.textContent = 'Click "Check Writing" to check your text.';

    checkResults.appendChild(empty);

    setEmailStatus('');

    updateStatistics();
    updateEmailPreview();
    saveDraft();

    textInput.focus();
}


// =========================
// DRAFT PERSISTENCE
// =========================

function saveDraft() {
    try {
        localStorage.setItem(STORAGE_KEYS.draftText, textInput.value);
        localStorage.setItem(STORAGE_KEYS.draftTo, emailTo.value);
        localStorage.setItem(STORAGE_KEYS.draftSubject, emailSubject.value);
    } catch (error) {
        // Storage unavailable.
    }
}

function scheduleDraftSave() {
    clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(saveDraft, DRAFT_SAVE_DELAY);
}

// The debounced save can still be pending when the page goes away.
window.addEventListener('beforeunload', () => {
    clearTimeout(draftSaveTimer);
    saveDraft();
});

function loadDraft() {
    try {
        const text = localStorage.getItem(STORAGE_KEYS.draftText) || '';
        const to = localStorage.getItem(STORAGE_KEYS.draftTo) || '';
        const subject = localStorage.getItem(STORAGE_KEYS.draftSubject) || '';

        if (text) textInput.value = text;
        if (to) emailTo.value = to;
        if (subject) emailSubject.value = subject;
    } catch (error) {
        // Storage unavailable.
    }
}


// =========================
// EVENT LISTENERS
// =========================

textInput.addEventListener('input', () => {
    updateStatistics();
    updateEmailPreview();
    scheduleDraftSave();
});

copyBtn.addEventListener('click', copyText);
checkBtn.addEventListener('click', checkWriting);
clearBtn.addEventListener('click', clearText);

emailBtn.addEventListener('click', openEmail);
copyEmailBtn.addEventListener('click', copyEmail);

emailTo.addEventListener('input', () => {
    updateEmailPreview();
    scheduleDraftSave();
});

emailSubject.addEventListener('input', () => {
    updateEmailPreview();
    scheduleDraftSave();
});

emojiBtn.addEventListener('click', () => {

    if (emojiPicker.hidden) {
        openEmojiPicker();
    } else {
        closeEmojiPicker();
    }
});

emojiPicker.addEventListener('click', event => {

    const button = event.target.closest('[data-emoji]');

    if (!button) return;

    insertEmoji(button.dataset.emoji);
});

document.addEventListener('click', event => {

    if (emojiPicker.hidden) return;
    if (emojiToolbar.contains(event.target)) return;

    closeEmojiPicker();
});

document.addEventListener('keydown', event => {

    if (event.key !== 'Escape') return;
    if (emojiPicker.hidden) return;

    closeEmojiPicker();
    emojiBtn.focus();
});


// =========================
// VERSION
// =========================

function updateVersionDisplay() {
    const [major, minor] = APP_VERSION.split('.');
    appVersionDisplay.textContent = `v${major}.${minor}`;
}


// =========================
// INIT
// =========================

loadDraft();
updateStatistics();
updateEmailPreview();
updateVersionDisplay();

// Offline support. Unavailable on file:// and where the user (or a
// policy) blocks service workers, so it is purely additive.
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {
            // Offline support unavailable; the app works online.
        });
    });
}