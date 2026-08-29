'use strict';

// Every renderer script must at least PARSE. overlay.js shipped broken in
// v1.4.137: a guest-code block added inside guestBootstrapSource's template
// literal used nested backtick templates, whose backticks terminated the
// outer template and left the file with a SyntaxError. The overlay renderer
// then never ran, so no HTML theme could load and the static mock scorebug
// showed forever. node --test never caught it because no test imports
// overlay.js. This test parses (without executing) every src/*.js.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const srcDir = path.join(__dirname, '..', 'src');

test('the syntax checker itself rejects the v1.4.137 overlay bug pattern', () => {
  const broken = 'const source = `outer ${1} ' +
    'document.querySelectorAll(`[data-x="${side}.record"]`);' +
    '`;';
  assert.throws(() => new vm.Script(broken), SyntaxError);
});

test('every renderer script in src/ parses', () => {
  const scripts = fs.readdirSync(srcDir).filter((name) => name.endsWith('.js'));
  assert.ok(scripts.length > 20, `expected the src/ scripts, saw ${scripts.length}`);
  for (const name of scripts) {
    const source = fs.readFileSync(path.join(srcDir, name), 'utf8');
    assert.doesNotThrow(
      () => new vm.Script(source, { filename: name }),
      `${name} must parse as JavaScript`,
    );
  }
});
