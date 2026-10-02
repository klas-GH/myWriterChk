// =========================
// DOM REFERENCES
// =========================

let lastTextBeforeFix = null;


const textInput = document.getElementById('textInput');

const wordCountDisplay = document.getElementById('wordCount');
const charCountDisplay = document.getElementById('charCount');
const sentenceCountDisplay = document.getElementById('sentenceCount');
const paragraphCountDisplay = document.getElementById('paragraphCount');

const copyBtn = document.getElementById('copyBtn');
const checkBtn = document.getElementById('checkBtn');
const clearBtn = document.getElementById('clearBtn');

const checkResults = document.getElementById('checkResults');

const emailTo = document.getElementById('emailTo');
const emailSubject = document.getElementById('emailSubject');
const emailBtn = document.getElementById('emailBtn');
const issueCountDisplay =  document.getElementById('issueCount');

const previewTo = document.getElementById('previewTo');
const previewSubject = document.getElementById('previewSubject');
const previewBody = document.getElementById('previewBody');
const emailReadyStatus =  document.getElementById('emailReadyStatus');
const emailStatus =    document.getElementById('emailStatus');
const copyEmailBtn =     document.getElementById('copyEmailBtn');
const emojiBtn = document.getElementById('emojiBtn');
const emojiPicker = document.getElementById('emojiPicker');

///theme
const themeToggle = document.getElementById('themeToggle');

function updateThemeButton() {
    themeToggle.textContent =
        document.body.classList.contains('dark-theme')
            ? '☀️'
            : '🌙';
}

// Load saved theme
const savedTheme = localStorage.getItem('theme');

if (savedTheme === 'dark') {
    document.body.classList.add('dark-theme');
}

updateThemeButton();

// Toggle theme
themeToggle.addEventListener('click', () => {

    document.body.classList.toggle('dark-theme');

    const isDark =
        document.body.classList.contains('dark-theme');

    localStorage.setItem(
        'theme',
        isDark ? 'dark' : 'light'
    );

    updateThemeButton();
});




// =========================
// EVENT LISTENERS
// =========================

textInput.addEventListener('input', updateStatistics);

copyBtn.addEventListener('click', copyText);

checkBtn.addEventListener('click', checkWriting);

clearBtn.addEventListener('click', clearText);

emailBtn.addEventListener('click', openEmail);
emailTo.addEventListener('input', updateEmailPreview);
emailSubject.addEventListener('input', updateEmailPreview);
textInput.addEventListener('input', updateEmailPreview);
copyEmailBtn.addEventListener('click', copyEmail);
emojiBtn.addEventListener('click', () => {

    emojiPicker.hidden = !emojiPicker.hidden;

});

emojiPicker.addEventListener('click', event => {

    const button = event.target.closest('[data-emoji]');

    if (!button) {
        return;
    }

    insertEmoji(button.dataset.emoji);

});


// =========================
// STATISTICS
// =========================

function updateStatistics() {

    const text = textInput.value;

    // Character Count
    charCountDisplay.textContent = text.length;


    // Word Count
    const words = text.match(/\S+/g) || [];

    wordCountDisplay.textContent = words.length;


    // Sentence Count
    const sentences = text
        .split(/[.!?]+(?=\s|$)/)
        .filter(sentence => sentence.trim().length > 0);

    sentenceCountDisplay.textContent = sentences.length;


    // Paragraph Count
    const paragraphs = text
        .split(/\n+/)
        .filter(paragraph => paragraph.trim().length > 0);

    paragraphCountDisplay.textContent = paragraphs.length;
}

//EMOJI
function insertEmoji(emoji) {

    const start = textInput.selectionStart;
    const end = textInput.selectionEnd;

    const text = textInput.value;

    textInput.value =
        text.slice(0, start) +
        emoji +
        text.slice(end);

    const newCursorPosition =
        start + emoji.length;

    textInput.focus();

    textInput.setSelectionRange(
        newCursorPosition,
        newCursorPosition
    );

    updateStatistics();
    updateEmailPreview();

    emojiPicker.hidden = true;
}



// =========================
// COPY
// =========================

async function copyText() {

    if (!textInput.value.trim()) {
        return;
    }

    // Visual feedback
    textInput.select();

    try {

        await navigator.clipboard.writeText(textInput.value);

        copyBtn.textContent = 'Copied!';

        setTimeout(() => {
            copyBtn.textContent = 'Copy Text';
        }, 1500);

    } catch (error) {

        console.error('Copy failed:', error);

        copyBtn.textContent = 'Copy Failed';

        setTimeout(() => {
            copyBtn.textContent = 'Copy Text';
        }, 1500);
    }
}


async function copyEmail() {

    const recipient = emailTo.value.trim();
    const subject = emailSubject.value.trim();
    const body = textInput.value.trim();

    if (!recipient) {

        emailStatus.textContent =
            'Please enter a recipient email address.';

        emailTo.focus();

        return;
    }

    if (!body) {

        emailStatus.textContent =
            'Please enter a message first.';

        textInput.focus();

        return;
    }

    const emailText =
        `To: ${recipient}\n` +
        `Subject: ${subject || '(No subject)'}\n\n` +
        body;

    try {

        await navigator.clipboard.writeText(emailText);

        copyEmailBtn.textContent = 'Copied!';

        emailStatus.textContent =
            'Email copied to clipboard.';

        setTimeout(() => {
            copyEmailBtn.textContent = 'Copy Email';
        }, 1500);

    } catch (error) {

        console.error('Copy email failed:', error);

        emailStatus.textContent =
            'Could not copy the email.';
    }
}



///updateEmailPreview
function updateEmailPreview() {

    const recipient = emailTo.value.trim();
    const subject = emailSubject.value.trim();
    const body = textInput.value.trim();

    previewTo.textContent =
        recipient || '—';

    previewSubject.textContent =
        subject || '—';

    previewBody.textContent =
        body || 'Your message will appear here.';

    if (recipient && body) {
        emailReadyStatus.textContent = 'Ready to send';
        emailBtn.classList.add('ready');
        emailBtn.textContent = 'Ready to Send';
    } else {
        emailReadyStatus.textContent = 'Ready to review';
        emailBtn.classList.remove('ready');
        emailBtn.textContent = 'Open in Email';
    }
}




// =========================
// WRITING CHECK
// =========================

function checkWriting() {

    const text = textInput.value.trim();

    checkResults.innerHTML = '';

    if (!text) {
        addCheckResult(
            'warning',
            'Enter some text first.'
        );
        return;
    }

    let issueCount = 0;
    let automaticFixes = [];
    issueCountDisplay.textContent = '';


    // 1. Double spaces
   if (/[ \t]{2,}/.test(text)) {

    issueCount++;

    automaticFixes.push('spaces');

    const multipleSpacesMatch =
        text.match(/[^\n]*[ \t]{2,}[^\n]*/);

    const multipleSpacesContext =
        multipleSpacesMatch
            ? multipleSpacesMatch[0].trim()
            : 'Multiple spaces';

    addCheckResult(
        'warning',
        `Multiple spaces detected: "${multipleSpacesContext}"`,
        'Fix',
        fixMultipleSpaces,
        {
            before: text,
            after: text.replace(/[ \t]{2,}/g, ' ')
        }
    );
}


    // 2. Space before punctuation
   if (/[ \t]+[,.!?;:]/.test(text)) {

    issueCount++;

    automaticFixes.push('punctuationSpace');

    const punctuationSpaceMatch =
        text.match(/[^\n]*[ \t]+[,.!?;:][^\n]*/);

    const punctuationSpaceContext =
        punctuationSpaceMatch
            ? punctuationSpaceMatch[0].trim()
            : 'Space before punctuation';

    addCheckResult(
        'warning',
        `Space before punctuation detected: "${punctuationSpaceContext}"`,
        'Fix',
        fixSpaceBeforePunctuation,
        {
            before: text,
            after: text.replace(
                /[ \t]+([,.!?;:])/g,
                '$1'
            )
        }
    );
}



    // 3. Missing space after punctuation
    if (/[.!?,;:][A-Za-zÀ-ÿ]/.test(text)) {

    issueCount++;

    automaticFixes.push('missingSpace');

    const missingSpaceMatch =
        text.match(/[^\n]*[.!?,;:][A-Za-zÀ-ÿ][^\n]*/);

    const missingSpaceContext =
        missingSpaceMatch
            ? missingSpaceMatch[0].trim()
            : 'Missing space after punctuation';

    addCheckResult(
        'warning',
        `Missing space after punctuation detected: "${missingSpaceContext}"`,
        'Fix',
        fixMissingSpaceAfterPunctuation,
        {
            before: text,
            after: text.replace(
                /([.!?,;:])(?=[A-Za-zÀ-ÿ])/g,
                '$1 '
            )
        }
    );
}
    


    // 4. Repeated punctuation
   if (/[!?]{2,}|\.{4,}/.test(text)) {

    issueCount++;

    automaticFixes.push('repeatedPunctuation');

    const repeatedPunctuationMatch =
        text.match(/[^\n]*([!?]{2,}|\.{4,})[^\n]*/);

    const repeatedPunctuationContext =
        repeatedPunctuationMatch
            ? repeatedPunctuationMatch[0].trim()
            : 'Repeated punctuation';

    addCheckResult(
        'warning',
        `Repeated punctuation detected: "${repeatedPunctuationContext}"`,
        'Fix',
        fixRepeatedPunctuation,
        {
            before: text,
            after: text
                .replace(/([!?]){2,}/g, '$1')
                .replace(/\.{4,}/g, '...')
        }
    );
}



    // 5. Repeated words
const repeatedWordPattern =
    /\b([A-Za-zÀ-ÿ']+)\s+\1\b/gi;

const repeatedWordMatch =
    repeatedWordPattern.exec(text);

if (repeatedWordMatch) {

    issueCount++;

    automaticFixes.push('repeatedWords');

    const repeatedPair =
        repeatedWordMatch[0];

    addCheckResult(
        'warning',
        `Repeated word detected: "${repeatedPair}"`,
        'Fix',
        fixRepeatedWords,
        {
            before: text,
            after: text.replace(
                /\b([A-Za-zÀ-ÿ']+)\s+\1\b/gi,
                '$1'
            )
        }
    );
}


// =========================
// 6.Lowercase sentence starts
// =========================

const lowercaseSentencePattern =
    /(^|[.!?]\s+)([a-zÀ-ÿ][a-zÀ-ÿ']*)/g;

const lowercaseMatches =
    [...text.matchAll(lowercaseSentencePattern)];

lowercaseMatches.forEach(match => {

    const firstWord = match[2];

    const startIndex =
        match.index + match[1].length;

    const sentenceStart =
        text.slice(startIndex).match(
            /^[^\n.!?]+[.!?]?/
        );

    const beforeSentence =
        sentenceStart
            ? sentenceStart[0].trim()
            : firstWord;

    const afterSentence =
        beforeSentence.replace(
            /^([a-zÀ-ÿ])/,
            letter => letter.toUpperCase()
        );

    issueCount++;

    addCheckResult(
    'warning',
    `"${firstWord}" should probably start with a capital letter.`,
    'Fix',
    () => fixSpecificSentenceWord(firstWord),
    {
        before: beforeSentence,
        after: afterSentence
    }
);



    automaticFixes.push('sentenceCapitalization');
});





// =========================
// Uppercase word after comma
// =========================


const commaCapitalPattern =
    /,\s+([A-ZÀ-Ý][a-zà-ÿ]+)/g;

const commaSuggestionWords = new Set([
    'And',
    'But',
    'Or',
    'So',
    'Because',
    'How',
    'Why',
    'What',
    'Where',
    'When',
    'Could',
    'Would',
    'Should',
    'Can',
    'Will'
]);

const commaMatches = [...text.matchAll(commaCapitalPattern)];

commaMatches.forEach(match => {

    const wordAfterComma = match[1];

    const commaStartIndex = match.index;

    const beforeText = text;

    const afterText =
        text.replace(
            new RegExp(
                `(,\\s+)${wordAfterComma}\\b`
            ),
            (fullMatch, commaAndSpace) => {
                return commaAndSpace + wordAfterComma.toLowerCase();
            }
        );

    issueCount++;

    addCheckResult(
        'warning',
        `"${wordAfterComma}" after a comma may not need capitalization.`,
        'Fix',
        () => fixSpecificCommaWord(wordAfterComma),
        {
            before: beforeText,
            after: afterText
        }
    );

    automaticFixes.push('commaCapitalization');
});





    // 7. Long sentences
  // =========================
// Long sentences
// =========================

const sentences = text
    .split(/[.!?]+/)
    .map(sentence => sentence.trim())
    .filter(sentence => sentence.length > 0);

const longSentences = sentences.filter(sentence => {

    const sentenceWords =
        sentence.match(/\S+/g) || [];

    return sentenceWords.length > 30;
});

longSentences.forEach(sentence => {

    const sentenceWords =
        sentence.match(/\S+/g) || [];

    const wordCount = sentenceWords.length;

    issueCount++;

    addCheckResult(
        'warning',
        `Long sentence detected: ${wordCount} words. Consider splitting it manually.`,
        null,
        null,
        {
            before: sentence,
            after: 'Consider splitting this sentence into shorter sentences.'
        }
    );
});



    // =========================
    // RESULT
    // =========================

    if (issueCount === 0) {

    issueCountDisplay.textContent = '✓ No issues';

    addCheckResult(
        'success',
        'No obvious writing issues were detected.'
    );

} else {

    issueCountDisplay.textContent =
        `${issueCount} ${issueCount === 1 ? 'issue' : 'issues'}`;

    addFixAllButton(automaticFixes);
}


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
    beforeLine.appendChild(
        document.createTextNode(beforeText)
    );

    afterLine.appendChild(afterLabel);
    afterLine.appendChild(
        document.createTextNode(afterText)
    );

    beforeLine.style.whiteSpace = 'pre-wrap';
    afterLine.style.whiteSpace = 'pre-wrap';

    preview.appendChild(beforeLine);
    preview.appendChild(afterLine);

    result.appendChild(preview);
}


function getSentenceContext(text, wordIndex) {

    let sentenceStart = wordIndex;

    while (
        sentenceStart > 0 &&
        !/[.!?]/.test(text[sentenceStart - 1])
    ) {
        sentenceStart--;
    }

    while (
        sentenceStart < text.length &&
        /\s/.test(text[sentenceStart])
    ) {
        sentenceStart++;
    }

    let sentenceEnd = wordIndex;

    while (
        sentenceEnd < text.length &&
        !/[.!?]/.test(text[sentenceEnd])
    ) {
        sentenceEnd++;
    }

    if (sentenceEnd < text.length) {
        sentenceEnd++;
    }

    return text
        .slice(sentenceStart, sentenceEnd)
        .trim();
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
    addPreview(
        result,
        preview.before,
        preview.after
    );
}

	if (buttonText && fixFunction) {

        const button = document.createElement('button');

        button.type = 'button';
        button.className = 'fix-btn';
        button.textContent = buttonText;

        button.addEventListener('click', () => {

    lastTextBeforeFix = textInput.value;

    fixFunction();

    checkWriting();

    addUndoButton();
});

        result.appendChild(button);
    }

    checkResults.appendChild(result);
}


function addUndoButton() {

    const undoButton = document.createElement('button');

    undoButton.type = 'button';
    undoButton.className = 'undo-btn';
    undoButton.textContent = 'Undo';

    undoButton.addEventListener('click', () => {

        if (lastTextBeforeFix === null) {
            return;
        }

        textInput.value = lastTextBeforeFix;

        lastTextBeforeFix = null;

        updateStatistics();

        checkWriting();
    });

    checkResults.appendChild(undoButton);
}


// =========================
// FIX ALL BUTTON
// =========================

function addFixAllButton(fixes) {
    const actions = document.createElement('div');
    actions.className = 'check-actions';

    const fixAllButton = document.createElement('button');

    fixAllButton.type = 'button';
    fixAllButton.className = 'fix-all-btn';
    fixAllButton.textContent = 'Fix All Safe Issues';

    fixAllButton.addEventListener('click', () => {

        fixes.forEach(fix => {

            switch (fix) {

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

            }
        });

        checkWriting();
    });

    actions.appendChild(fixAllButton);

    checkResults.appendChild(actions);
}


// =========================
// FIX FUNCTIONS
// =========================

// Fix:
// "Hello  John"
// →
// "Hello John"

function fixMultipleSpaces() {

    textInput.value =
        textInput.value.replace(/[ \t]{2,}/g, ' ');

    updateStatistics();
}


// Fix:
// "Hello , world"
// →
// "Hello, world"

function fixSpaceBeforePunctuation() {

    textInput.value =
        textInput.value.replace(
            /[ \t]+([,.!?;:])/g,
            '$1'
        );

    updateStatistics();
}


// Fix:
// "Hi John,How are you?"
// →
// "Hi John, How are you?"

function fixMissingSpaceAfterPunctuation() {

    textInput.value =
        textInput.value.replace(
            /([.!?,;:])(?=[A-Za-zÀ-ÿ])/g,
            '$1 '
        );

    updateStatistics();
}


// Fix:
// "Really!!"
// →
// "Really!"

function fixRepeatedPunctuation() {

    textInput.value =
        textInput.value
            .replace(/([!?]){2,}/g, '$1')
            .replace(/\.{4,}/g, '...');

    updateStatistics();
}


// Fix:
// "This is is a test."
// →
// "This is a test."

function fixRepeatedWords() {

    textInput.value =
        textInput.value.replace(
            /\b([A-Za-zÀ-ÿ']+)\s+\1\b/gi,
            '$1'
        );

    updateStatistics();
}


// Fix:
// "hello world. this is a test."
// →
// "Hello world. This is a test."

function fixSentenceCapitalization() {

    textInput.value =
        textInput.value.replace(
            /(^|[.!?]\s+)([a-z])/g,
            (match, beginning, letter) => {
                return beginning + letter.toUpperCase();
            }
        );

    updateStatistics();
}

//fixSpecificSentenceWord
function fixSpecificSentenceWord(word) {

    const pattern = new RegExp(
        `(^|[.!?]\\s+)${word}\\b`
    );

    textInput.value =
        textInput.value.replace(
            pattern,
            (match, beginning) => {
                return beginning + word.charAt(0).toUpperCase() + word.slice(1);
            }
        );

    updateStatistics();
}


//fix commaCap
function fixSpecificCommaWord(word) {

    const pattern = new RegExp(
        `(,\\s+)${word}\\b`
    );

    textInput.value =
        textInput.value.replace(
            pattern,
            (match, commaAndSpace) => {
                return commaAndSpace + word.toLowerCase();
            }
        );

    updateStatistics();
}

//fix all commaCap
function fixAllCommaCapitalization() {

    textInput.value =
        textInput.value.replace(
            /,\s+([A-ZÀ-Ý][a-zà-ÿ]+)/g,
            (match, word) => {
                return `, ${word.toLowerCase()}`;
            }
        );

    updateStatistics();
}



// =========================
// CLEAR
// =========================

function clearText() {

    textInput.value = '';

    updateStatistics();

    checkResults.innerHTML = `
        <p class="check-empty">
            Click "Check Writing" to check your text.
        </p>
    `;
}


// =========================
// EMAIL
// =========================

function openEmail() {

    const recipient = emailTo.value.trim();
    const subject = emailSubject.value.trim();
    const body = textInput.value.trim();

    emailStatus.textContent = '';

    if (!recipient) {

        emailStatus.textContent =
            'Please enter a recipient email address.';

        emailTo.focus();

        return;
    }

    if (!body) {

        emailStatus.textContent =
            'Please enter a message first.';

        textInput.focus();

        return;
    }

    const mailtoUrl =
        `mailto:${encodeURIComponent(recipient)}` +
        `?subject=${encodeURIComponent(subject)}` +
        `&body=${encodeURIComponent(body)}`;

    window.location.href = mailtoUrl;
}

