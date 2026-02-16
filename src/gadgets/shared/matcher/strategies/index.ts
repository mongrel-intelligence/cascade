/**
 * Layered matching strategies for file editing.
 * Exported in order of precedence: exact → whitespace → indentation → fuzzy → dmp
 */

export { dmpMatch } from './dmp.js';
export { exactMatch } from './exact.js';
export { fuzzyMatch } from './fuzzy.js';
export { indentationMatch } from './indentation.js';
export { whitespaceMatch } from './whitespace.js';
