// Test entry point. Run with: npm test
//
// Each suite exports a function that receives a reporter. Suites may return a
// promise; the runner waits for it before moving on.

const { createReporter } = require('./harness');

const SUITES = [
    ['rules', './rules.test.js'],
    ['app', './app.test.js'],
    ['state', './state.test.js'],
    ['fuzz', './fuzz.test.js'],
    ['css', './css.test.js']
];

async function main() {
    const started = Date.now();
    let pass = 0;
    let fail = 0;
    const failures = [];

    for (const [name, file] of SUITES) {
        const reporter = createReporter(name);
        let error = null;

        try {
            const suite = require(file);
            await suite(reporter);
        } catch (caught) {
            error = caught;
        }

        pass += reporter.state.pass;
        fail += reporter.state.fail;
        failures.push(...reporter.state.failures);

        const status = error ? 'ERROR' : reporter.state.fail ? 'FAIL' : 'pass';
        console.log(
            '  ' + status.padEnd(5) +
            name.padEnd(8) +
            String(reporter.state.pass).padStart(4) + ' passed' +
            (reporter.state.fail ? ', ' + reporter.state.fail + ' failed' : '') +
            (error ? '  ' + error.message : '')
        );

        if (error) {
            console.log(error.stack);
            break;
        }
    }

    if (failures.length) {
        console.log('\nFailures:');
        failures.forEach((failure, index) => {
            console.log(
                '\n  ' + (index + 1) + ') [' + failure.section + '] ' + failure.label +
                '\n     ' + String(failure.detail).split('\n').join('\n     ')
            );
        });
    }

    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
        '\n' + pass + ' passed, ' + fail + ' failed  (' + seconds + 's)'
    );

    process.exit(fail || failures.length ? 1 : 0);
}

main();
