// Tests for the parts that were previously untested: the statistics panel,
// the email workflow (validation, ready states, mailto guard), the clipboard
// actions and emoji insertion.

const { createEnv } = require('./harness');

module.exports = function app(t) {
    const env = createEnv();
    const api = env.api;
    const els = env.els;

    const statsFor = text => {
        env.setText(text);
        api.updateStatistics();
        return env.stats();
    };

    // ---------------------------------------------------------------------
    t.section('statistics');

    t.eq('empty textarea', statsFor(''),
        { words: '0', chars: '0', sentences: '0', paragraphs: '0' });

    t.eq('simple sentence', statsFor('Hello world.'),
        { words: '2', chars: '12', sentences: '1', paragraphs: '1' });

    t.eq('counts each sentence',
        statsFor('One. Two. Three.').sentences, '3');

    t.eq('does not split on e.g. or decimals',
        statsFor('See e.g. this and 3.14 today.').sentences, '1');

    t.eq('a trailing full stop still counts as one sentence',
        statsFor('No punctuation here').sentences, '1');

    t.eq('counts paragraphs on blank-line separation',
        statsFor('First para.\n\nSecond para.').paragraphs, '2');

    t.eq('each non-empty line counts as a paragraph',
        statsFor('Line one\nLine two').paragraphs, '2');
    t.eq('a blank line does not add a paragraph of its own',
        statsFor('One.\n\nTwo.').paragraphs, '2');

    t.eq('whitespace-only paragraphs are ignored',
        statsFor('Real.\n\n   \n\nAlso real.').paragraphs, '2');

    t.eq('character count includes spaces and newlines',
        statsFor('ab\ncd').chars, '5');

    t.eq('character count of an empty document is zero',
        statsFor('').chars, '0');

    t.eq('words split on any whitespace run',
        statsFor('a\tb   c').words, '3');

    t.eq('punctuation-only input still counts a word',
        statsFor('...').words, '1');

    t.eq('statistics update live on input events', (() => {
        env.type('one two three');
        return env.stats().words;
    })(), '3');

    // ---------------------------------------------------------------------
    t.section('email validation');

    t.eq('no recipient', api.getRecipientError([]),
        'Please enter a recipient email address.');
    t.eq('single valid', api.getRecipientError(['a@b.com']), null);
    t.eq('multiple valid', api.getRecipientError(['a@b.com', 'c@d.com']), null);
    t.eq('subdomains are valid', api.getRecipientError(['a.b@mail.example.co.uk']), null);
    t.eq('plus addressing is valid', api.getRecipientError(['a+tag@b.com']), null);
    t.eq('clearly invalid', api.getRecipientError(['nope']),
        'Invalid email address: nope');
    t.eq('one bad among good',
        api.getRecipientError(['a@b.com', 'bad']), 'Invalid email address: bad');
    t.eq('several bad are all named',
        api.getRecipientError(['bad', 'worse']), 'Invalid email addresses: bad, worse');
    t.eq('missing @ rejected', api.getRecipientError(['ab.com']),
        'Invalid email address: ab.com');
    t.eq('missing tld rejected', api.getRecipientError(['a@b']),
        'Invalid email address: a@b');
    t.eq('one-letter tld rejected', api.getRecipientError(['a@b.c']),
        'Invalid email address: a@b.c');
    t.eq('space inside address rejected',
        api.getRecipientError(['a b@c.com']), 'Invalid email address: a b@c.com');
    t.eq('trailing comma is not a recipient',
        api.parseRecipients('a@b.com,').length, 1);

    t.eq('splits on comma', api.parseRecipients('a@b.com, c@d.com').length, 2);
    t.eq('splits on semicolon', api.parseRecipients('a@b.com; c@d.com').length, 2);
    t.eq('mixed separators', api.parseRecipients('a@b.com, c@d.com; e@f.com').length, 3);
    t.eq('trims whitespace', api.parseRecipients(' a@b.com , c@d.com ').join('|'),
        'a@b.com|c@d.com');
    t.eq('ignores empty entries', api.parseRecipients('a@b.com,,c@d.com').length, 2);
    t.eq('whitespace-only input yields nothing', api.parseRecipients('   ').length, 0);

    // ---------------------------------------------------------------------
    t.section('email preview and ready state');

    env.setText('');
    api.updateEmailPreview();

    t.eq('missing recipient blocks ready',
        els.emailReadyStatus.textContent, 'Check the recipient address');
    t.eq('button is not ready', els.emailBtn.classList.contains('ready'), false);
    t.eq('recipient field is flagged', els.emailTo.getAttribute('aria-invalid'), 'true');
    t.eq('preview shows a placeholder recipient', els.previewTo.textContent, '—');
    t.eq('preview shows a placeholder subject', els.previewSubject.textContent, '—');
    t.eq('preview shows a placeholder body', els.previewBody.textContent,
        'Your message will appear here.');

    // Valid recipient, no body yet: ready to review, not ready to send.
    els.emailTo.value = 'a@b.com';
    api.updateEmailPreview();
    t.eq('valid recipient alone is "ready to review"',
        els.emailReadyStatus.textContent, 'Ready to review');
    t.eq('button still not ready without a body',
        els.emailBtn.classList.contains('ready'), false);
    t.eq('recipient field is no longer flagged',
        els.emailTo.getAttribute('aria-invalid'), 'false');

    env.setText('Hello there.');
    api.updateEmailPreview();
    t.eq('recipient plus body is ready to send',
        els.emailReadyStatus.textContent, 'Ready to send');
    t.eq('ready class applied to the status',
        els.emailReadyStatus.classList.contains('ready'), true);
    t.eq('ready class applied to the button',
        els.emailBtn.classList.contains('ready'), true);
    t.eq('preview shows the recipient', els.previewTo.textContent, 'a@b.com');
    t.eq('preview shows the body', els.previewBody.textContent, 'Hello there.');
    t.eq('whitespace-only body is not a body', (() => {
        env.setText('   \n  ');
        api.updateEmailPreview();
        return els.emailBtn.classList.contains('ready');
    })(), false);

    els.emailSubject.value = 'Hi';
    api.updateEmailPreview();
    t.eq('preview shows the subject', els.previewSubject.textContent, 'Hi');

    els.emailTo.value = 'not-an-email';
    api.updateEmailPreview();
    t.eq('invalid recipient blocks ready',
        els.emailBtn.classList.contains('ready'), false);
    t.eq('invalid recipient is called out',
        els.emailReadyStatus.textContent, 'Check the recipient address');
    t.eq('aria-invalid returns',
        els.emailTo.getAttribute('aria-invalid'), 'true');

    t.eq('one bad address among several still blocks ready', (() => {
        els.emailTo.value = 'a@b.com, nope';
        api.updateEmailPreview();
        return els.emailBtn.classList.contains('ready');
    })(), false);

    // ---------------------------------------------------------------------
    t.section('mailto construction');

    els.emailTo.value = 'a@b.com, c@d.com';
    els.emailSubject.value = 'Hi there';
    env.setText('Line 1\nLine 2');
    api.openEmail();

    const href = env.sandbox.window.location.href;
    t.ok('mailto URL built', href.startsWith('mailto:'));
    t.includes('recipients are not percent-encoded', href, 'mailto:a@b.com,c@d.com?');
    t.includes('newlines become CRLF', href, '%0D%0A');
    t.includes('subject is encoded', href, 'subject=Hi%20there');
    t.eq('the full URL is exact', href,
        'mailto:a@b.com,c@d.com?subject=Hi%20there&body=Line%201%0D%0ALine%202');

    els.emailTo.value = 'a@b.com';
    els.emailSubject.value = '';
    api.openEmail();
    t.includes('empty subject still produces a subject param',
        env.sandbox.window.location.href, '?subject=&');

    t.eq('special characters in the body are encoded, not injected', (() => {
        env.setText('a&b=c?d');
        api.openEmail();
        return env.sandbox.window.location.href;
    })(), 'mailto:a@b.com?subject=&body=a%26b%3Dc%3Fd');

    t.eq('a subject containing & is encoded', (() => {
        els.emailSubject.value = 'A & B';
        env.setText('Body');
        api.openEmail();
        return env.sandbox.window.location.href.includes('subject=A%20%26%20B');
    })(), true);

    const beforeMissingRecipient = env.sandbox.window.location.href;

    els.emailTo.value = '';
    api.openEmail();
    t.eq('no recipient blocks the link',
        env.sandbox.window.location.href, beforeMissingRecipient);
    t.includes('and explains why', els.emailStatus.textContent, 'Please enter a recipient');
    t.eq('status is styled as an error', els.emailStatus.className, 'email-status error');

    els.emailTo.value = 'a@b.com';
    env.setText('');
    api.openEmail();
    t.includes('empty body blocks the link', els.emailStatus.textContent,
        'Please enter a message');
    t.eq('href still unchanged', env.sandbox.window.location.href, beforeMissingRecipient);

    t.eq('an invalid recipient is reported by name', (() => {
        els.emailTo.value = 'nope';
        env.setText('Body');
        api.openEmail();
        return els.emailStatus.textContent;
    })(), 'Invalid email address: nope');

    // A long message must be refused rather than silently truncated by the OS.
    els.emailTo.value = 'a@b.com';
    env.setText('word '.repeat(1200));
    const beforeTooLong = env.sandbox.window.location.href;
    api.openEmail();
    t.includes('over-long message is refused', els.emailStatus.textContent,
        'too long for a mail link');
    t.includes('and points at Copy Email', els.emailStatus.textContent, 'Copy Email');
    t.includes('and states the limit', els.emailStatus.textContent,
        String(api.MAILTO_MAX_LENGTH));
    t.eq('href unchanged after refusal', env.sandbox.window.location.href, beforeTooLong);

    t.eq('a message just under the limit is allowed', (() => {
        // Build a body that keeps the finished URL under the cap.
        const limit = api.MAILTO_MAX_LENGTH;
        const prefix = 'mailto:a@b.com?subject=&body=';
        els.emailSubject.value = '';
        env.setText('x'.repeat(limit - prefix.length - 1));
        api.openEmail();
        return env.sandbox.window.location.href.length <= limit &&
            env.sandbox.window.location.href.startsWith(prefix);
    })(), true);

    t.eq('clearing the status happens on the next successful attempt', (() => {
        env.setText('Body');
        api.openEmail();
        return els.emailStatus.textContent;
    })(), '');

    // ---------------------------------------------------------------------
    t.section('emoji insertion');

    t.eq('the picker starts hidden', els.emojiPicker.hidden, true);
    t.eq('the button reports collapsed', els.emojiBtn.getAttribute('aria-expanded'), 'false');

    els.emojiBtn.click();
    t.eq('clicking the button opens the picker', els.emojiPicker.hidden, false);
    t.eq('and updates aria-expanded', els.emojiBtn.getAttribute('aria-expanded'), 'true');
    els.emojiBtn.click();
    t.eq('clicking again closes it', els.emojiPicker.hidden, true);
    t.eq('and restores aria-expanded', els.emojiBtn.getAttribute('aria-expanded'), 'false');

    t.eq('Escape closes the picker', (() => {
        els.emojiBtn.click();
        env.fire('keydown', { key: 'Escape' });
        return els.emojiPicker.hidden;
    })(), true);
    t.eq('Escape does nothing when already closed', (() => {
        env.fire('keydown', { key: 'Escape' });
        return els.emojiPicker.hidden;
    })(), true);
    t.eq('other keys do not close the picker', (() => {
        els.emojiBtn.click();
        env.fire('keydown', { key: 'a' });
        const stillOpen = els.emojiPicker.hidden === false;
        els.emojiBtn.click();
        return stillOpen;
    })(), true);

    t.eq('a click outside the toolbar dismisses the picker', (() => {
        els.emojiBtn.click();
        env.fire('click', { target: { tag: 'div' } });
        return els.emojiPicker.hidden;
    })(), true);

    t.eq('a click inside the toolbar keeps it open', (() => {
        els.emojiBtn.click();
        const inner = { tag: 'span' };
        els.emojiToolbar.appendChild(inner);
        env.fire('click', { target: inner });
        const stillOpen = els.emojiPicker.hidden === false;
        els.emojiBtn.click();
        return stillOpen;
    })(), true);

    t.eq('a document click is ignored while the picker is closed', (() => {
        env.fire('click', { target: { tag: 'div' } });
        return els.emojiPicker.hidden;
    })(), true);

    t.eq('an emoji is inserted at the caret', (() => {
        env.setText('Hello world');
        env.setSelection(5);
        api.insertEmoji('😀');
        return env.getText();
    })(), 'Hello😀 world');
    t.eq('inserting closes the picker', els.emojiPicker.hidden, true);
    t.eq('the caret sits after the emoji',
        [els.textInput.selectionStart, els.textInput.selectionEnd], [7, 7]);
    t.eq('the textarea keeps focus', els.textInput._focused, true);
    t.eq('statistics reflect the emoji', env.stats().words, '2');

    t.eq('an emoji replaces the selection', (() => {
        env.setText('Hello world');
        env.setSelection(6, 11);
        api.insertEmoji('🎉');
        return env.getText();
    })(), 'Hello 🎉');

    t.eq('an emoji at the start of the text', (() => {
        env.setText('Hi');
        env.setSelection(0);
        api.insertEmoji('👍');
        return env.getText();
    })(), '👍Hi');

    t.eq('an emoji at the end of the text', (() => {
        env.setText('Hi');
        env.setSelection(2);
        api.insertEmoji('✅');
        return env.getText();
    })(), 'Hi✅');

    t.eq('a multi-code-unit emoji does not corrupt the text', (() => {
        env.setText('ab');
        env.setSelection(1);
        api.insertEmoji('❤️');
        return env.getText();
    })(), 'a❤️b');
    t.eq('and the caret lands after it',
        els.textInput.selectionStart, 'a❤️'.length);

    t.eq('an emoji inserted into empty text works', (() => {
        env.setText('');
        env.setSelection(0);
        api.insertEmoji('🚀');
        return env.getText();
    })(), '🚀');

    t.eq('picking an emoji from the picker inserts it', (() => {
        env.setText('note');
        env.setSelection(4);
        const button = { dataset: { emoji: '⭐' } };
        els.emojiPicker.dispatch('click', { target: { closest: () => button } });
        return env.getText();
    })(), 'note⭐');

    t.eq('a click outside any emoji is ignored', (() => {
        env.setText('note');
        els.emojiPicker.dispatch('click', { target: { closest: () => null } });
        return env.getText();
    })(), 'note');

    // ---------------------------------------------------------------------
    t.section('clipboard actions');

    return (async () => {
        env.setText('Copy me please.');
        await api.copyText();
        t.eq('Copy Text writes the message',
            env.clipboard[env.clipboard.length - 1], 'Copy me please.');
        t.eq('Copy Text confirms on the button', els.copyBtn.textContent, 'Copied!');

        env.runTimers(1500);
        t.eq('the button label reverts', els.copyBtn.textContent, 'Copy Text');

        env.setText('   ');
        const beforeEmptyCopy = env.clipboard.length;
        await api.copyText();
        t.eq('nothing is copied from empty text', env.clipboard.length, beforeEmptyCopy);
        t.eq('and the user is told why', els.copyBtn.textContent, 'Nothing to copy');
        env.runTimers(1500);

        env.setText('The body');
        env.sandbox.navigator.clipboard.writeText = async () => { throw new Error('denied'); };
        await api.copyText();
        t.eq('a rejected clipboard is reported, not thrown', els.copyBtn.textContent, 'Copy Failed');
        env.runTimers(1500);

        env.sandbox.navigator.clipboard.writeText = async text => { env.clipboard.push(text); };

        els.emailTo.value = 'a@b.com';
        els.emailSubject.value = 'Subject';
        env.setText('The body');
        await api.copyEmail();
        const copied = env.clipboard[env.clipboard.length - 1];
        t.eq('Copy Email writes To, Subject and body', copied,
            'To: a@b.com\nSubject: Subject\n\nThe body');
        t.eq('Copy Email reports success', els.emailStatus.className, 'email-status success');
        t.eq('and confirms on the button', els.copyEmailBtn.textContent, 'Copied!');
        env.runTimers(1500);

        els.emailSubject.value = '  ';
        env.setText('Body');
        await api.copyEmail();
        t.includes('a blank subject is labelled', env.clipboard[env.clipboard.length - 1],
            'Subject: (No subject)');
        env.runTimers(1500);

        els.emailTo.value = 'bad';
        await api.copyEmail();
        t.eq('Copy Email rejects a bad recipient',
            els.emailStatus.className, 'email-status error');
        t.includes('and says why', els.emailStatus.textContent, 'Invalid email address');
        t.eq('and copies nothing', env.clipboard[env.clipboard.length - 1].includes('To: bad'), false);

        els.emailTo.value = 'a@b.com';
        env.setText('   ');
        await api.copyEmail();
        t.eq('Copy Email needs a body', els.emailStatus.textContent,
            'Please enter a message first.');
        t.eq('styled as an error', els.emailStatus.className, 'email-status error');

        env.setText('Body');
        env.sandbox.navigator.clipboard.writeText = async () => { throw new Error('denied'); };
        await api.copyEmail();
        t.eq('clipboard failure surfaces as an error message',
            els.emailStatus.className, 'email-status error');
        t.includes('with manual-copy advice', els.emailStatus.textContent, 'copy manually');
    })();
};