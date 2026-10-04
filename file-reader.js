'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_FILE_BYTES = 96 * 1024;
const FORMATS = Object.freeze({
  '.txt': 'text', '.text': 'text', '.log': 'text',
  '.md': 'markdown', '.markdown': 'markdown', '.json': 'json'
});

function readReadableFile(inputPath) {
  if (typeof inputPath !== 'string' || !path.isAbsolute(inputPath) || /[\x00-\x1f\x7f]/.test(inputPath)) {
    throw new Error('Choose an absolute local file path');
  }
  const filePath = fs.realpathSync(inputPath);
  const format = FORMATS[path.extname(filePath).toLowerCase()];
  if (!format) throw new Error('Only text, Markdown, and JSON files are supported');
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error('Choose a regular file');
  if (stat.size > MAX_FILE_BYTES) throw new Error('File is too large for the XR reader (96 KB maximum)');
  const buffer = fs.readFileSync(filePath);
  if (buffer.length > MAX_FILE_BYTES) throw new Error('File is too large for the XR reader (96 KB maximum)');
  let content;
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { throw new Error('File is not UTF-8 text'); }
  if (content.includes('\0')) throw new Error('Binary files cannot be opened in the XR reader');
  if (format === 'json') {
    try { content = JSON.stringify(JSON.parse(content), null, 2); }
    catch (error) { throw new Error(`Invalid JSON: ${error.message}`); }
  }
  return { path: filePath, name: path.basename(filePath), format, bytes: buffer.length, content };
}

module.exports = { MAX_FILE_BYTES, readReadableFile };
