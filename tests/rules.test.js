// Checker rule tests: each grammar rule, both what it must fix and what it
// must never touch.

const { createEnv } = require('./harness');

module.exports = function rules(t) {
    const env = createEnv();
    const api = env.api;

    const fixMissing = input => {
        env.setText(input);
        api.fixMissingSpaceAfterPunctuation();
        return env.getText();
    };

    const capAll = input => {
        env.setText(input);
        api.fixSentenceCapitalization();
        return env.getText();
    };

    const commaAll = input => {
        env.setText(input);
        api.fixAllCommaCapitalization();
        return env.getText();
    };

    // ---------------------------------------------------------------------
    t.section('missing space after punctuation');

    [
        'See https://ex.ample.com for info',
        'Visit www.example.com today',
        'Mail me at john.smith@ex.ample.com',
        'The U.S.A team replied',
        'That is e.g. a valid point',
        'The price is 3.14 exactly',
        'Version 1.5 shipped',
        'I prefer i.e. the second option',
        'Ref No.5 is missing'
    ].forEach(input => {
        t.eq('must not touch: ' + input, api.findMissingSpaceIndexes(input).length, 0);
    });

    [
        ['Hi John,How are you?', 'Hi John, How are you?'],
        ['Done.Then we left', 'Done. Then we left'],
        ['Wow!Great job', 'Wow! Great job'],
        ['See https://ex.ample.com, e.g. 3.14, John.Smith',
            'See https://ex.ample.com, e.g. 3.14, John. Smith'],
        ['Done.Then see ex.ample.com, and U.S.A office.',
            'Done. Then see ex.ample.com, and U.S.A office.'],
        ['Ref No.5, Fig.2, and etc.Also fine.',
            'Ref No.5, Fig.2, and etc. Also fine.'],
        ['Built on v1.2.3 today', 'Built on v1.2.3 today'],
        ['Mail bob@ex.ample.com.Then reply.',
            'Mail bob@ex.ample.com. Then reply.'],
        ['Cost: $5.99.Total is fine.', 'Cost: $5.99. Total is fine.'],
        ['Domain then sentence: ex.ample.com.Then we left.',
            'Domain then sentence: ex.ample.com. Then we left.']
    ].forEach(([input, expected]) => {
        t.eq('fixes: ' + JSON.stringify(input), fixMissing(input), expected);
    });

    // A capitalised domain must still be recognised as a domain.
    t.eq('capitalised domain survives',
        api.isProtectedPeriod('That.www.foo.co.uk', 5), true);
    t.eq('internal domain dot survives',
        api.isProtectedPeriod('ex.ample.com.Then', 2), true);
    t.eq('domain then capital is a sentence break',
        api.isProtectedPeriod('ex.ample.com.Then', 12), false);
    t.eq('email dot survives',
        api.isProtectedPeriod('bob@ex.ample.com', 6), true);
    t.eq('quoted word is not an abbreviation',
        api.isProtectedPeriod('said "no". she left', 9), false);

    // ---------------------------------------------------------------------
    t.section('comma capitalization');

    [
        ['Hi John, I sent it.', 0],
        ['Please, Google is down.', 0],
        ['Bob, London is nice.', 0],
        ['We shipped it, However we waited.', 1],
        ['Done, And reviewed.', 1],
        ['Fine, But slow.', 1]
    ].forEach(([input, expected]) => {
        const flagged = [...input.matchAll(/,\s+(\p{Lu}\p{Ll}+)/gu)]
            .filter(m => api.LOWER_AFTER_COMMA.has(m[1].toLowerCase()));
        t.eq('flags ' + expected + ' in ' + JSON.stringify(input), flagged.length, expected);
    });

    t.eq('Fix All keeps proper nouns',
        commaAll('Hi John, I sent it. Bob, London is nice.'),
        'Hi John, I sent it. Bob, London is nice.');
    t.eq('Fix All lowercases whitelist words',
        commaAll('We shipped it, However we waited.'),
        'We shipped it, however we waited.');
    t.eq('Fix All preserves original spacing',
        commaAll('Shipped,   However late.'),
        'Shipped,   however late.');

    // ---------------------------------------------------------------------
    t.section('repeated words (legitimate doubles preserved)');

    t.eq('the the -> the', api.removeRepeatedWords('She the the man.'), 'She the man.');
    t.eq('had had preserved', api.removeRepeatedWords('He had had enough.'), 'He had had enough.');
    t.eq('that that preserved', api.removeRepeatedWords('I know that that is true.'), 'I know that that is true.');
    t.eq('very very preserved', api.removeRepeatedWords('It was very very cold.'), 'It was very very cold.');
    t.eq('keeps casing of first word', api.removeRepeatedWords('The the end.'), 'The end.');

    // ---------------------------------------------------------------------
    t.section('repeated punctuation');

    t.eq('Really!! -> Really!', api.collapseRepeatedPunctuation('Really!!'), 'Really!');
    t.eq('Wow??? -> Wow?', api.collapseRepeatedPunctuation('Wow???'), 'Wow?');
    t.eq('Wait.... -> Wait...', api.collapseRepeatedPunctuation('Wait....'), 'Wait...');
    t.eq('mixed ?! left alone', api.collapseRepeatedPunctuation('Really?!'), 'Really?!');
    t.eq('ellipsis left alone', api.collapseRepeatedPunctuation('Wait... then'), 'Wait... then');

    // ---------------------------------------------------------------------
    t.section('sentence capitalization');

    t.eq('after a period', capAll('hello world. this is a test.'), 'Hello world. This is a test.');
    t.eq('after a line break',
        capAll('First line ok.\nsecond line bad\nthird line bad'),
        'First line ok.\nSecond line bad\nThird line bad');
    t.eq('indented line start',
        capAll('One.\n    two starts indented'),
        'One.\n    Two starts indented');
    t.eq('after a closing quote', capAll('He said "no". she left'), 'He said "no". She left');
    t.eq('acronym not capitalised', capAll('e.g. this works'), 'e.g. this works');
    t.eq('domain chain untouched', capAll('Use the U.S.A. office, and e.g. this.'), 'Use the U.S.A. office, and e.g. this.');
    t.eq('mid-sentence acronym keeps next word lowercase',
        capAll('Use i.e. the second one, and then stop.'),
        'Use i.e. the second one, and then stop.');

    // ---------------------------------------------------------------------
    t.section('sentence splitting');

    [
        ['Hello there. How are you?', 2],
        ['One only', 1],
        ['See e.g. this and 3.14 today.', 1],
        ['A.B.C is fine. Next one.', 2],
        ['Really?! Yes it is.', 2]
    ].forEach(([input, expected]) => {
        t.eq('split ' + JSON.stringify(input), api.splitSentences(input).length, expected);
    });

    // ---------------------------------------------------------------------
    t.section('long sentence detection');

    // 40 distinct words so no other rule fires and the length is unambiguous.
    const longSentence = Array.from({ length: 40 }, (_, i) => 'word' + i).join(' ') + '.';
    const longIssues = api.collectIssues(longSentence).issues
        .filter(i => i.message.startsWith('Long sentence'));
    t.eq('a 40-word sentence is flagged', longIssues.length, 1);
    t.eq('the limit is ' + api.LONG_SENTENCE_WORDS + ' words', api.LONG_SENTENCE_WORDS, 30);
    t.ok('and it reports the real count', longIssues[0].message.includes('(40 words)'));
    t.eq('long sentence offers no bogus "after" preview', longIssues[0].preview, null);
    t.eq('long sentence is not auto-fixable', longIssues[0].fix, null);
    t.eq('long sentence does not appear in Fix All',
        api.collectIssues(longSentence).fixKeys.includes('longSentences'), false);

    const shortSentence = Array.from({ length: 30 }, (_, i) => 'word' + i).join(' ') + '.';
    t.eq('a 30-word sentence is exactly at the limit and not flagged',
        api.collectIssues(shortSentence).issues.filter(i => i.message.startsWith('Long sentence')).length, 0);

    t.eq('a short sentence is not flagged',
        api.collectIssues('This sentence is short enough to be fine.').issues
            .filter(i => i.message.startsWith('Long sentence')).length, 0);

    // ---------------------------------------------------------------------
    t.section('issue reporting');

    const three = api.collectIssues('Bad  spacing!!here');
    t.eq('three separate rules fire on one line', three.total, 3);
    t.eq('and each is fixable', three.fixKeys, ['spaces', 'missingSpace', 'repeatedPunctuation']);

    // A rule that fires more than MAX_ISSUES_PER_RULE times must not produce an
    // unbounded results list.
    const many = 'A  b  c  d  e  f  g  h  i  j  k';
    const result = api.collectIssues(many);
    const listed = result.issues.filter(i => i.severity !== 'info');

    t.eq('only the multiple-spaces rule fires',
        [...new Set(result.issues.filter(i => i.fixKey).map(i => i.fixKey))], ['spaces']);
    t.eq('listed items are capped at ' + api.MAX_ISSUES_PER_RULE, listed.length, api.MAX_ISSUES_PER_RULE);
    t.eq('the listed total excludes the overflow notice', result.total, api.MAX_ISSUES_PER_RULE);
    t.eq('exactly one overflow notice is added',
        result.issues.filter(i => i.severity === 'info').length, 1);
    t.ok('the notice names the hidden count',
        result.issues.find(i => i.severity === 'info').message.includes('more multiple spaces issue'));
    t.eq('the overflow notice is not fixable',
        result.issues.find(i => i.severity === 'info').fix, null);
    t.eq('the rule is still offered to Fix All', result.fixKeys, ['spaces']);

    // Every fixable issue carries the function that repairs it.
    const allFixable = api.collectIssues('a  b,the the c!!d end')
        .issues.filter(i => i.fixKey);
    t.ok('every fixable issue exposes a fix function',
        allFixable.length > 0 && allFixable.every(i => typeof i.fix === 'function'));
    t.ok('every fixable issue exposes a before/after preview',
        allFixable.every(i => i.preview && 'before' in i.preview && 'after' in i.preview &&
            i.preview.before !== i.preview.after));

    const keys = api.collectIssues('a  b,the the c!!d. end').fixKeys;
    t.eq('Fix All reports rules in FIX_ORDER', keys, api.FIX_ORDER.filter(k => keys.includes(k)));
    t.eq('whitespace rules run before text rules',
        api.FIX_ORDER.indexOf('spaces') < api.FIX_ORDER.indexOf('missingSpace'), true);
    t.eq('missing spaces run before capitalization, which would hide them',
        api.FIX_ORDER.indexOf('missingSpace') < api.FIX_ORDER.indexOf('sentenceCapitalization'), true);
    t.eq('comma capitalization runs last',
        api.FIX_ORDER.indexOf('commaCapitalization'),
        api.FIX_ORDER.length - 1);
};