// Theme, draft persistence, undo and resilience tests.

const { createEnv, readApp, headScript } = require('./harness');

module.exports = function state(t) {
    // ---------------------------------------------------------------------
    t.section('theme');

    const dark = createEnv({ preset: { theme: 'dark' } });
    t.eq('head script applies dark before script.js runs', dark.darkBeforeJs, true);
    t.eq('button shows the sun', dark.els.themeToggle.textContent, '☀️');
    t.eq('aria-pressed reflects state', dark.els.themeToggle.getAttribute('aria-pressed'), 'true');

    const light = createEnv();
    t.eq('no stored preference stays light', light.darkBeforeJs, false);
    t.eq('button shows the moon', light.els.themeToggle.textContent, '🌙');
    t.eq('aria-pressed false', light.els.themeToggle.getAttribute('aria-pressed'), 'false');

    t.eq('any value other than "dark" is light',
        createEnv({ preset: { theme: 'purple' } }).darkBeforeJs, false);

    const toggle = createEnv();
    toggle.els.themeToggle.click();
    t.eq('click persists dark', toggle.store.theme, 'dark');
    t.eq('click adds the class',
        toggle.sandbox.document.documentElement.classList.contains('dark-theme'), true);
    t.eq('button updates', toggle.els.themeToggle.textContent, '☀️');
    t.eq('aria-pressed updates', toggle.els.themeToggle.getAttribute('aria-pressed'), 'true');

    toggle.els.themeToggle.click();
    t.eq('click persists light', toggle.store.theme, 'light');
    t.eq('class removed',
        toggle.sandbox.document.documentElement.classList.contains('dark-theme'), false);
    t.eq('button reverts', toggle.els.themeToggle.textContent, '🌙');
    t.eq('aria-pressed reverts', toggle.els.themeToggle.getAttribute('aria-pressed'), 'false');

    // The literal in the inline head script and the constant in script.js are
    // duplicated on purpose; if either changes without the other, the theme
    // silently stops working. Assert the two agree.
    const headKey = headScript().match(/localStorage\.getItem\('([^']+)'\)/)[1];
    const scriptKey = readApp('script.js').match(/theme:\s*'([^']+)'/)[1];
    t.eq('both files use the same storage key', headKey, scriptKey);
    t.eq('and script.js writes that key', toggle.store[scriptKey], 'light');
    t.eq('a fresh boot honours that key',
        createEnv({ preset: { [scriptKey]: 'dark' } }).darkBeforeJs, true);

    // ---------------------------------------------------------------------
    t.section('draft persistence');

    const d = createEnv();
    d.setText('half written message');
    d.els.emailTo.value = 'a@b.com';
    d.els.emailSubject.value = 'Draft subject';
    d.api.saveDraft();
    t.eq('text stored', d.store.draftText, 'half written message');
    t.eq('recipient stored', d.store.draftTo, 'a@b.com');
    t.eq('subject stored', d.store.draftSubject, 'Draft subject');

    const restored = createEnv({ preset: d.store });
    t.eq('text restored', restored.els.textInput.value, 'half written message');
    t.eq('recipient restored', restored.els.emailTo.value, 'a@b.com');
    t.eq('subject restored', restored.els.emailSubject.value, 'Draft subject');
    t.eq('statistics reflect the restored draft', restored.stats().words, '3');
    t.eq('the preview reflects the restored draft',
        restored.els.previewBody.textContent, 'half written message');

    t.eq('an empty stored draft leaves the fields alone', (() => {
        const blank = createEnv({ preset: { draftText: '', draftTo: '' } });
        return [blank.els.textInput.value, blank.els.emailTo.value];
    })(), ['', '']);

    t.eq('clear wipes the text but keeps the addressing', (() => {
        const c = createEnv({ preset: d.store });
        c.api.clearText();
        return [c.store.draftText, c.store.draftTo, c.store.draftSubject];
    })(), ['', 'a@b.com', 'Draft subject']);

    // ---------------------------------------------------------------------
    t.section('debounced saving');

    const debounce = createEnv();
    debounce.setText('typing');
    debounce.api.scheduleDraftSave();
    t.eq('nothing is written before the delay elapses', debounce.store.draftText, undefined);
    debounce.setText('typing more');
    debounce.api.scheduleDraftSave();
    debounce.runTimers(debounce.api.DRAFT_SAVE_DELAY - 1);
    t.eq('still nothing just before the delay', debounce.store.draftText, undefined);
    debounce.runTimers();
    t.eq('the latest text is saved once the delay elapses',
        debounce.store.draftText, 'typing more');
    t.eq('and only one timer was pending', debounce.pendingTimers(), 0);

    t.eq('typing fires the same debounced save', (() => {
        const live = createEnv();
        live.type('hello there');
        t.eq('live typing does not write immediately', live.store.draftText, undefined);
        live.runTimers();
        return live.store.draftText;
    })(), 'hello there');

    t.eq('leaving the page flushes a pending save', (() => {
        const leaving = createEnv();
        leaving.setText('unsaved words');
        leaving.api.scheduleDraftSave();
        leaving.fireWindow('beforeunload');
        return leaving.store.draftText;
    })(), 'unsaved words');

    t.eq('leaving the page cancels the pending timer', (() => {
        const leaving = createEnv();
        leaving.setText('words');
        leaving.api.scheduleDraftSave();
        leaving.fireWindow('beforeunload');
        return leaving.pendingTimers();
    })(), 0);

    // ---------------------------------------------------------------------
    t.section('clearText resets everything');

    const c = createEnv();
    c.setText('bad  text!!here');
    c.api.checkWriting();
    t.ok('issues were reported', c.els.issueCount.textContent.includes('issue'));
    t.ok('and results were rendered', c.els.checkResults._children.length > 0);

    c.api.clearText();
    t.eq('text cleared', c.getText(), '');
    t.eq('issue count cleared', c.els.issueCount.textContent, '');
    t.eq('results replaced with a placeholder', c.els.checkResults._children.length, 1);
    t.eq('placeholder text', c.els.checkResults._children[0].textContent,
        'Click "Check Writing" to check your text.');
    t.eq('undo history cleared', c.api.undoStack.length, 0);
    t.eq('statistics cleared', c.stats(),
        { words: '0', chars: '0', sentences: '0', paragraphs: '0' });
    t.eq('email status cleared', c.els.emailStatus.textContent, '');
    t.eq('the textarea keeps focus', c.els.textInput._focused, true);

    // ---------------------------------------------------------------------
    t.section('check writing results');

    const w = createEnv();
    w.setText('Perfectly fine writing.');
    w.api.checkWriting();
    t.eq('a clean document reports no issues', w.els.issueCount.textContent, '✓ No issues');
    t.eq('and renders a success item',
        w.els.checkResults._children[0].className, 'check-item success');
    t.eq('no Fix All button is offered', w.els.checkResults._children.length, 1);

    const d2 = createEnv();
    d2.setText('a  b,the the c!!d end');
    d2.api.checkWriting();
    t.eq('the count is shown', d2.els.issueCount.textContent,
        String(d2.api.collectIssues('a  b,the the c!!d end').total) + ' issues');
    t.ok('a Fix All button is offered',
        d2.els.checkResults._children.some(child => child.className === 'check-actions'));
    t.ok('fix buttons are rendered',
        d2.els.checkResults._children.some(child =>
            (child._children || []).some(c => c.className === 'fix-btn')));

    t.eq('Fix All asks for confirmation before running', (() => {
        const env = createEnv();
        const asked = [];
        env.sandbox.window.confirm = message => { asked.push(message); return true; };
        env.setText('a  b,the the c!!d end');
        env.api.checkWriting();
        const fixAll = env.els.checkResults._children
            .flatMap(child => child._children || [])
            .find(child => child.className === 'fix-all-btn');
        fixAll.click();
        return [asked.length, asked[0].includes('Fix all safe issues?')];
    })(), [1, true]);

    t.eq('declining the confirmation changes nothing', (() => {
        const env = createEnv();
        env.sandbox.window.confirm = () => false;
        env.setText('a  b,the the c!!d end');
        env.api.checkWriting();
        const fixAll = env.els.checkResults._children
            .flatMap(child => child._children || [])
            .find(child => child.className === 'fix-all-btn');
        fixAll.click();
        return env.getText();
    })(), 'a  b,the the c!!d end');

    t.eq('a single Fix button repairs only its own issue', (() => {
        const env = createEnv();
        env.setText('a  b');
        env.api.checkWriting();
        const fix = env.els.checkResults._children
            .flatMap(child => child._children || [])
            .find(child => child.className === 'fix-btn');
        fix.click();
        return env.getText();
    })(), 'a b');

    t.eq('Fix All leaves no outstanding fixable issue', (() => {
        const env = createEnv();
        env.sandbox.window.confirm = () => true;
        const input = 'a  b,the the c!!d end. bad  caps here';
        env.setText(input);
        env.api.checkWriting();
        const fixAll = env.els.checkResults._children
            .flatMap(child => child._children || [])
            .find(child => child.className === 'fix-all-btn');
        fixAll.click();
        return env.api.collectIssues(env.getText()).fixKeys;
    })(), []);

    t.eq('an empty document prompts instead of reporting', (() => {
        const env = createEnv();
        env.api.checkWriting();
        return [
            env.els.issueCount.textContent,
            env.els.checkResults._children[0]._children[0].textContent
        ];
    })(), ['', 'Enter some text first.']);

    // ---------------------------------------------------------------------
    t.section('undo');

    const u = createEnv();
    u.setText('the the cat');
    u.api.pushUndo();
    u.api.fixRepeatedWords();
    t.eq('fix applied', u.getText(), 'the cat');
    u.api.undo();
    t.eq('undo restores the original', u.getText(), 'the the cat');
    t.eq('the stack is empty again', u.api.undoStack.length, 0);
    u.api.undo();
    t.eq('undo on an empty stack is a no-op', u.getText(), 'the the cat');

    t.eq('undo also restores the statistics and preview', (() => {
        const env = createEnv();
        env.setText('one two three');
        env.api.pushUndo();
        env.els.textInput.value = '';
        env.api.updateStatistics();
        env.api.undo();
        return [env.stats().words, env.els.previewBody.textContent];
    })(), ['3', 'one two three']);

    t.eq('the stack records each change', (() => {
        const stack = createEnv();
        stack.setText('a the the b the the c');
        stack.api.pushUndo();
        stack.api.pushUndo();
        stack.api.pushUndo();
        return stack.api.undoStack.length;
    })(), 3);

    t.eq('the stack is capped at MAX_UNDO', (() => {
        const cap = createEnv();
        for (let i = 0; i < 120; i++) cap.api.pushUndo();
        return cap.api.undoStack.length;
    })(), 50);

    t.eq('undo survives several round trips', (() => {
        const env = createEnv();
        env.setText('bad  text!!here');
        env.api.checkWriting();
        const fixAll = env.els.checkResults._children
            .flatMap(child => child._children || [])
            .find(child => child.className === 'fix-all-btn');
        env.sandbox.window.confirm = () => true;
        fixAll.click();
        const fixed = env.getText();
        env.api.undo();
        return [fixed, env.getText()];
    })(), ['Bad text! Here', 'bad  text!!here']);

    // ---------------------------------------------------------------------
    t.section('nothing throws');

    const r = createEnv();
    [
        '', '   ', '\n\n\n', 'Perfectly fine text.', 'bad  spacing , here!!the end', 'x',
        'A very long sentence. '.repeat(3), 'multi\nline\nbad caps',
        'Visit https://ex.ample.com or mail bob@ex.ample.com.Then reply.',
        '😀🎉❤️'.repeat(20), 'a'.repeat(5000), '.'.repeat(500), ','.repeat(500)
    ].forEach(sample => {
        let threw = null;
        try {
            r.setText(sample);
            r.api.updateStatistics();
            r.api.updateEmailPreview();
            r.api.checkWriting();
            r.api.collectIssues(sample).fixKeys.forEach(key => r.api.runFix(key));
            r.api.saveDraft();
        } catch (error) {
            threw = error.message;
        }
        t.eq('no throw for ' + JSON.stringify(sample.slice(0, 28)), threw, null);
    });

    t.eq('the textarea is never left with undefined', r.getText().includes('undefined'), false);
    t.eq('or with NaN', r.getText().includes('NaN'), false);

    // ---------------------------------------------------------------------
    t.section('storage unavailable (private browsing)');

    let booted = null;
    try {
        booted = createEnv({ hostile: true });
    } catch (error) {
        t.ok('app failed to boot without localStorage: ' + error.message, false);
    }

    if (booted) {
        let threw = null;
        try {
            booted.setText('some text!!here');
            booted.els.emailTo.value = 'a@b.com';
            booted.api.updateStatistics();
            booted.api.saveDraft();
            booted.api.loadDraft();
            booted.api.checkWriting();
            booted.api.updateEmailPreview();
            booted.els.themeToggle.click();
            booted.api.clearText();
        } catch (error) {
            threw = error.message;
        }
        t.eq('every entry point survives a throwing localStorage', threw, null);
        t.eq('and the app still works', booted.getText(), '');
        t.eq('and the theme still toggles',
            booted.sandbox.document.documentElement.classList.contains('dark-theme'), true);
    }
};
