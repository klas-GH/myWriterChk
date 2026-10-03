// Randomised robustness test. Generates adversarial text from a corpus of
// URLs, acronyms, decimals, abbreviations and punctuation, then repeatedly
// applies Fix All looking for exceptions, non-determinism and non-convergence.

const { createEnv } = require('./harness');

const WORDS = [
    'the', 'Hi', 'John', 'e.g', 'i.e', 'U.S.A', 'however', 'However', 'And',
    'had', 'that', 'had had', 'very very', 'no', 'Inc', 'Mr', 'St', 'etc',
    'etc.Also', 'https://ex.ample.com', 'www.foo.co.uk', 'bob@ex.ample.com',
    '3.14', 'v1.2.3', 'No.5', 'Fig.2', 'a', 'I', 'OK', 'dept', 'ref',
    'u.s.a', 'sent', 'Alex', 'thanks', 'say', '"no"', 'don\'t', '$5.99', 'e-mail'
];
const PUNCT = ['.', '!', '?', ',', ';', ':', '...', '!!', '?!', ' ', '  ', '\n', '\t', ')', '"'];

function mulberry32(a) {
    return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

module.exports = function fuzz(t) {
    const env = createEnv();
    const api = env.api;
    const random = mulberry32(20261002);
    const pick = arr => arr[Math.floor(random() * arr.length)];

    const randomText = () => {
        const n = Math.floor(random() * 25) + 1;
        let out = '';
        for (let i = 0; i < n; i++) out += pick(WORDS) + pick(PUNCT);
        return out;
    };

    const applyFixAll = text => {
        const res = api.collectIssues(text);
        env.setText(text);
        res.fixKeys.forEach(key => api.runFix(key));
        return env.getText();
    };

    const ITERATIONS = Number(process.env.FUZZ_ITERATIONS || 3000);
    let exceptions = 0;
    let nonDeterministic = 0;
    let neverConverged = 0;
    let maxPasses = 0;

    for (let i = 0; i < ITERATIONS; i++) {
        const original = randomText();

        try {
            // Detection must be side-effect free and repeatable.
            const a = api.collectIssues(original);
            const b = api.collectIssues(original);
            if (JSON.stringify(a) !== JSON.stringify(b)) {
                nonDeterministic++;
                continue;
            }

            // Fix All must reach a fixed point.
            let current = applyFixAll(original);
            let passes = 0;

            while (passes < 12) {
                if (!api.collectIssues(current).fixKeys.length) break;
                const next = applyFixAll(current);
                if (next === current) { current = next; break; }
                current = next;
                passes++;
            }

            if (passes >= 12) neverConverged++;
            if (passes > maxPasses) maxPasses = passes;

            // Invariants that must never break.
            if (typeof current !== 'string') throw new Error('result was not a string');
            if (current.includes('undefined')) throw new Error('result contains "undefined"');
            if (current.includes('NaN')) throw new Error('result contains "NaN"');
        } catch (e) {
            exceptions++;
            if (exceptions <= 3) {
                t.ok('exception on ' + JSON.stringify(original) + ': ' + e.message, false);
            }
        }
    }

    t.eq('no exceptions in ' + ITERATIONS + ' random inputs', exceptions, 0);
    t.eq('detection is deterministic', nonDeterministic, 0);
    t.eq('Fix All always converges', neverConverged, 0);
    t.ok('converges within a few passes (max ' + maxPasses + ')', maxPasses <= 3);

    // ------------------------------------------------------- performance
    //
    // A slow check freezes the tab, so both the scan and Fix All must
    // stay responsive. Timings are taken as the fastest of several
    // runs, because a shared or loaded machine can spike any single
    // measurement; the minimum is a stable estimate of the real cost.
    // Budgets sit well above the measured minimum, so they catch an
    // algorithmic regression (10x or worse) rather than machine noise.
    t.section('performance (a slow check freezes the tab)');

    const RUNS = 3;

    // Fastest of several full check + Fix All passes, in milliseconds.
    const bestOf = input => {
        let fastest = Infinity;
        for (let run = 0; run < RUNS; run++) {
            const start = Date.now();
            api.collectIssues(input);
            applyFixAll(input);
            fastest = Math.min(fastest, Date.now() - start);
        }
        return fastest;
    };

    // Ordinary prose: whitespace-separated short tokens, which is what
    // the punctuation guards actually see in normal use. Measured 1-110ms.
    const prose = {
        'prose': 'The quick brown fox jumps. It lands well. '.repeat(80),
        'prose with URLs': 'See https://ex.ample.com/page for '.repeat(90),
        'prose with emails': 'Mail bob@ex.ample.com today. '.repeat(90),
        'long spaces': 'a'.repeat(3) + ' '.repeat(4000) + 'b',
        'long letters': 'a'.repeat(4000),
        'repeated words': 'ab '.repeat(2000),
        'dot runs': '.'.repeat(4000),
        'commas + capitals': ',Ab '.repeat(1500),
        'mixed punctuation': 'a.b, c!d?e;f:g '.repeat(400),
        'long email-like': 'someone.long.name@example.com, '.repeat(200)
    };

    Object.entries(prose).forEach(([name, input]) => {
        const ms = bestOf(input);
        t.ok('prose: ' + name + ' (' + input.length + ' chars) in ' + ms + 'ms',
            ms < 400);
    });

    // Degraded whitespace-free input, tracked separately because it is a
    // genuinely different code path and measurably slower.
    //
    // With no whitespace, every period sits in a token that spans the
    // whole document, and each listed issue recomputes the line's
    // before/after preview. That is MAX_ISSUES_PER_RULE passes over a
    // line that never ends, so cost grows with document length rather
    // than staying flat. Measured ~550ms at 2k chars and ~2.2s at 8k.
    // Realistic prose is unaffected (1-4ms at the same sizes) because
    // its lines are short, so this is a worst case to keep visible
    // rather than a claim about normal use.
    const runOnMs = bestOf('One.Two.Three.'.repeat(140));
    t.ok('worst case: run-on text (1960 chars) in ' + runOnMs + 'ms',
        runOnMs < 2500);

    t.ok('and prose is not paying for that worst case', (() => {
        const sample = 'The quick brown fox jumps. It lands well. '.repeat(200);
        return bestOf(sample);
    })() < 400, true);

    // Cost must stay proportional to input size: a super-linear regression
    // (quadratic or worse) shows up here even when absolute times are small.
    t.ok('cost grows no faster than linearly with input size', (() => {
        const small = 'One.Two.Three.'.repeat(70);
        const large = 'One.Two.Three.'.repeat(280);
        const bestCollect = input => {
            let fastest = Infinity;
            for (let run = 0; run < RUNS; run++) {
                const start = Date.now();
                api.collectIssues(input);
                fastest = Math.min(fastest, Date.now() - start);
            }
            return Math.max(fastest, 1);
        };
        // Warm up so JIT compilation is not attributed to the first run.
        bestCollect(small);
        const smallMs = bestCollect(small);
        const largeMs = bestCollect(large);
        // 4x the input; quadratic would be 16x. Allow generous headroom.
        return largeMs < smallMs * 8;
    })(), true);
};