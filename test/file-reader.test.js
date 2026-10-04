'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readReadableFile } = require('../file-reader');

test('file reader accepts bounded UTF-8 text, Markdown, and formatted JSON', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xr-file-reader-test-'));
  try {
    for (const [name, content, format] of [['note.txt', 'hello', 'text'], ['readme.md', '# Title', 'markdown'], ['data.json', '{"a":1}', 'json']]) {
      const file = path.join(directory, name);
      fs.writeFileSync(file, content);
      const result = readReadableFile(file);
      assert.equal(result.format, format);
      assert.equal(result.name, name);
      assert.ok(result.content.includes(format === 'json' ? '  "a": 1' : content));
    }
    assert.throws(() => readReadableFile('relative.txt'), /absolute/);
    const invalid = path.join(directory, 'bad.json');
    fs.writeFileSync(invalid, '{');
    assert.throws(() => readReadableFile(invalid), /Invalid JSON/);
    const binary = path.join(directory, 'binary.txt');
    fs.writeFileSync(binary, Buffer.from([0, 1, 2]));
    assert.throws(() => readReadableFile(binary), /Binary files/);
    const large = path.join(directory, 'large.md');
    fs.writeFileSync(large, 'a'.repeat(96 * 1024 + 1));
    assert.throws(() => readReadableFile(large), /too large/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
