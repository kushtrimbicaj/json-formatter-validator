(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------
  const HIGHLIGHT_LIMIT = 300000; // Skip syntax highlighting above this many characters
  const PREVIEW_LIMIT = 500000; // Show only a preview above this many characters (copy and download stay complete)
  const TOAST_DURATION_MS = 2400;
  const INDENT_OPTIONS = {
    '2': { value: 2, label: '2 spaces' },
    '4': { value: 4, label: '4 spaces' },
    tab: { value: '\t', label: 'tabs' },
  };

  const EXAMPLE_DOCUMENT = {
    project: { name: 'orbit-api', version: '2.4.1', private: false, license: null },
    maintainers: [
      { name: 'Zoë Müller', email: 'zoe@example.com', active: true },
      { name: 'Kenji Watanabe', email: 'kenji@example.com', active: false },
    ],
    config: {
      port: 8080,
      timeoutSeconds: 12.5,
      retries: 3,
      cache: { enabled: true, ttl: 3600, regions: ['eu-central', 'us-east'] },
      motd: 'He said "ship it" and left.',
    },
    tags: [],
    scores: [98.6, -4, 0, 1.5e-3],
    matrix: [[1, 0], [0, 1]],
    deprecated: null,
  };

  // Matches strings (optionally followed by a colon, making them keys), literals, and numbers.
  const TOKEN_PATTERN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\b(null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

  // ---------------------------------------------------------------------------
  // State and element references
  // ---------------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);

  const el = {
    input: $('jsonInput'),
    inputStats: $('inputStats'),
    outputWrap: $('outputWrap'),
    outputPre: $('outputPre'),
    outputCode: $('outputCode'),
    outputStats: $('outputStats'),
    emptyState: $('emptyState'),
    status: $('status'),
    statusIcon: $('statusIcon'),
    statusLabel: $('statusLabel'),
    statusMessage: $('statusMessage'),
    errorBox: $('errorBox'),
    errorLocation: $('errorLocation'),
    errorHint: $('errorHint'),
    errorGoto: $('errorGoto'),
    toast: $('toast'),
    toastIcon: $('toastIcon'),
    toastText: $('toastText'),
    copyButton: document.querySelector('[data-action="copy"]'),
    downloadButton: document.querySelector('[data-action="download"]'),
  };

  const state = {
    output: '',
    outputMode: null, // 'format' | 'minify' | null
    errorIndex: null,
    parseCache: null, // { text, value } for the last successful parse
    toastTimer: null,
    statsFrame: null,
  };

  // ---------------------------------------------------------------------------
  // Parsing and error analysis
  // ---------------------------------------------------------------------------
  function lineColumnFromIndex(text, index) {
    let line = 1;
    let lineStart = 0;
    for (let i = text.indexOf('\n'); i !== -1 && i < index; i = text.indexOf('\n', i + 1)) {
      line += 1;
      lineStart = i + 1;
    }
    return { line, column: index - lineStart + 1 };
  }

  function indexFromLineColumn(text, line, column) {
    let lineStart = 0;
    for (let current = 1; current < line; current += 1) {
      const newline = text.indexOf('\n', lineStart);
      if (newline === -1) return null;
      lineStart = newline + 1;
    }
    const index = lineStart + column - 1;
    return index <= text.length ? index : null;
  }

  // Browsers word parse errors differently, so the location is only reported
  // when the message actually contains one.
  function extractErrorIndex(message, text) {
    const lineColumn = message.match(/line (\d+) column (\d+)/i);
    if (lineColumn) {
      const index = indexFromLineColumn(text, Number(lineColumn[1]), Number(lineColumn[2]));
      return index === null ? null : index;
    }
    const position = message.match(/position (\d+)/i);
    if (position && Number(position[1]) <= text.length) return Number(position[1]);
    return null;
  }

  function cleanErrorMessage(message) {
    return message
      .replace(/^JSON\.parse:\s*/i, '')
      .replace(/^JSON Parse error:\s*/i, '')
      .replace(/,?\s*".*"\s*is not valid JSON$/is, '')
      .replace(/\s+in JSON at position \d+(\s*\(line \d+ column \d+\))?/i, '')
      .replace(/\s+at line \d+ column \d+ of the JSON data/i, '')
      .trim();
  }

  function previousSignificantChar(text, index) {
    for (let i = index - 1; i >= 0; i -= 1) {
      if (!/\s/.test(text[i])) return text[i];
    }
    return '';
  }

  function suggestFix(message, text, index) {
    const tokenMatch = message.match(/Unexpected token '(.)'/);
    const char = index !== null && index < text.length ? text[index] : tokenMatch ? tokenMatch[1] : '';
    const previous = index !== null ? previousSignificantChar(text, index) : '';

    if (char === "'") return 'JSON uses double quotes for strings and property names, not single quotes.';
    if ((char === '}' || char === ']') && previous === ',') return 'Trailing commas are not allowed in JSON. Remove the comma before this character.';
    if (char === '/' || char === '#') return 'JSON does not support comments.';
    if (/^[A-Za-z_$]$/.test(char) && (previous === '{' || previous === ',')) return 'Property names must be wrapped in double quotes.';
    const atEnd = index !== null && index >= text.trimEnd().length;
    if (atEnd || /unexpected end|end of (JSON )?(data|input)/i.test(message)) return 'The input ends early. Check for an unclosed brace, bracket, or string.';
    if (/expected ',' or|after (property value|array element)/i.test(message)) return 'A comma may be missing between values.';
    if (/escape/i.test(message)) return 'A string contains an invalid escape sequence. Use \\\\ for a literal backslash.';
    if (/control character|bad control/i.test(message)) return 'Strings cannot contain raw line breaks or tabs. Escape them as \\n or \\t.';
    return '';
  }

  function describeParseError(error, text) {
    const rawMessage = String((error && error.message) || error);
    const index = extractErrorIndex(rawMessage, text);
    const location = index === null ? null : lineColumnFromIndex(text, index);
    return {
      summary: cleanErrorMessage(rawMessage) || 'The input is not valid JSON.',
      index,
      line: location && location.line,
      column: location && location.column,
      hint: suggestFix(rawMessage, text, index),
    };
  }

  function parseInput() {
    const text = el.input.value;
    if (!text.trim()) return { ok: false, empty: true };
    if (state.parseCache && state.parseCache.text === text) {
      return { ok: true, value: state.parseCache.value };
    }
    try {
      const value = JSON.parse(text);
      state.parseCache = { text, value };
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: describeParseError(error, text) };
    }
  }

  function describeValue(value) {
    if (Array.isArray(value)) return `array with ${value.length.toLocaleString()} ${value.length === 1 ? 'item' : 'items'}`;
    if (value === null) return 'null';
    if (typeof value === 'object') {
      const count = Object.keys(value).length;
      return `object with ${count.toLocaleString()} ${count === 1 ? 'key' : 'keys'}`;
    }
    return typeof value;
  }

  // ---------------------------------------------------------------------------
  // Formatting and minification
  // ---------------------------------------------------------------------------
  function getIndentOption() {
    const selected = document.querySelector('input[name="indent"]:checked');
    return INDENT_OPTIONS[selected ? selected.value : '2'];
  }

  const formatJson = (value, indent) => JSON.stringify(value, null, indent);
  const minifyJson = (value) => JSON.stringify(value);

  // ---------------------------------------------------------------------------
  // UI updates (all text goes through textContent / text nodes, never innerHTML)
  // ---------------------------------------------------------------------------
  function countLines(text) {
    if (!text) return 0;
    let lines = 1;
    for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) lines += 1;
    return lines;
  }

  const formatCounts = (text) =>
    `${countLines(text).toLocaleString()} ${countLines(text) === 1 ? 'line' : 'lines'}, ${text.length.toLocaleString()} characters`;

  function updateInputStats() {
    el.inputStats.textContent = formatCounts(el.input.value);
  }

  function setStatus(name, message) {
    const labels = { idle: 'Not validated', valid: 'Valid JSON', invalid: 'Invalid JSON' };
    const icons = { idle: '#i-idle', valid: '#i-validate', invalid: '#i-x-circle' };
    el.status.dataset.state = name;
    el.statusLabel.textContent = labels[name];
    el.statusIcon.setAttribute('href', icons[name]);
    el.statusMessage.textContent = message;
  }

  function resetStatus() {
    setStatus('idle', 'Paste JSON on the left, then format, minify, or validate it.');
  }

  function showError(error) {
    state.errorIndex = error.index;
    el.errorLocation.textContent = error.index === null ? '' : `Line ${error.line}, column ${error.column}`;
    el.errorHint.textContent = [
      error.index === null ? 'Exact location is not available from this browser\u2019s error message.' : '',
      error.hint,
    ].filter(Boolean).join(' ');
    el.errorGoto.hidden = error.index === null;
    el.errorBox.hidden = false;
  }

  function hideError() {
    state.errorIndex = null;
    el.errorBox.hidden = true;
  }

  function buildHighlighted(text) {
    const fragment = document.createDocumentFragment();
    const appendToken = (className, content) => {
      const span = document.createElement('span');
      span.className = className;
      span.textContent = content;
      fragment.append(span);
    };

    let cursor = 0;
    for (const match of text.matchAll(TOKEN_PATTERN)) {
      if (match.index > cursor) fragment.append(text.slice(cursor, match.index));
      const [whole, string, colon, boolean, nullLiteral] = match;
      if (string !== undefined && colon !== undefined) {
        appendToken('tok-key', string);
        fragment.append(colon);
      } else if (string !== undefined) {
        appendToken('tok-str', string);
      } else if (boolean !== undefined) {
        appendToken('tok-bool', whole);
      } else if (nullLiteral !== undefined) {
        appendToken('tok-null', whole);
      } else {
        appendToken('tok-num', whole);
      }
      cursor = match.index + whole.length;
    }
    if (cursor < text.length) fragment.append(text.slice(cursor));
    return fragment;
  }

  function renderOutput() {
    const hasOutput = state.output !== '';
    el.emptyState.hidden = hasOutput;
    el.outputPre.hidden = !hasOutput;
    el.copyButton.disabled = !hasOutput;
    el.downloadButton.disabled = !hasOutput;

    if (!hasOutput) {
      el.outputCode.textContent = '';
      el.outputStats.textContent = 'Nothing to show';
      return;
    }

    const isPreview = state.output.length > PREVIEW_LIMIT;
    if (state.output.length > HIGHLIGHT_LIMIT) {
      // Large output: plain text, and only a preview when it would make the page sluggish.
      el.outputCode.textContent = isPreview ? state.output.slice(0, PREVIEW_LIMIT) : state.output;
    } else {
      el.outputCode.replaceChildren(buildHighlighted(state.output));
    }
    el.outputWrap.scrollTop = 0;

    const modeLabel = state.outputMode === 'minify' ? 'Minified' : `Formatted with ${getIndentOption().label}`;
    let note = '';
    if (isPreview) note = `, showing the first ${PREVIEW_LIMIT.toLocaleString()} characters (Copy and Download include everything)`;
    else if (state.output.length > HIGHLIGHT_LIMIT) note = ', highlighting off for large output';
    el.outputStats.textContent = `${modeLabel}, ${formatCounts(state.output)}${note}`;
  }

  function setOutput(text, mode) {
    state.output = text;
    state.outputMode = mode;
    renderOutput();
  }

  function clearOutput() {
    setOutput('', null);
  }

  function showToast(message, tone = 'success') {
    window.clearTimeout(state.toastTimer);
    el.toast.dataset.tone = tone;
    el.toastIcon.setAttribute('href', tone === 'success' ? '#i-validate' : '#i-x-circle');
    el.toastText.textContent = message;
    el.toast.classList.add('is-visible');
    state.toastTimer = window.setTimeout(dismissToast, TOAST_DURATION_MS);
  }

  function dismissToast() {
    window.clearTimeout(state.toastTimer);
    el.toast.classList.remove('is-visible');
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  function reportParseFailure(result) {
    clearOutput();
    if (result.empty) {
      hideError();
      setStatus('idle', 'Nothing to process. Paste JSON or load the example.');
      el.input.focus();
      return;
    }
    setStatus('invalid', result.error.summary);
    showError(result.error);
  }

  function runFormat() {
    const result = parseInput();
    if (!result.ok) return reportParseFailure(result);
    hideError();
    const indent = getIndentOption();
    setOutput(formatJson(result.value, indent.value), 'format');
    setStatus('valid', `Root value: ${describeValue(result.value)}. Formatted with ${indent.label}.`);
  }

  function runMinify() {
    const result = parseInput();
    if (!result.ok) return reportParseFailure(result);
    hideError();
    setOutput(minifyJson(result.value), 'minify');
    setStatus('valid', `Root value: ${describeValue(result.value)}. Minified.`);
  }

  function runValidate() {
    const result = parseInput();
    if (!result.ok) return reportParseFailure(result);
    hideError();
    setStatus('valid', `Root value: ${describeValue(result.value)}.`);
  }

  async function writeToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (error) {
        // Fall through to the legacy path below.
      }
    }
    const helper = document.createElement('textarea');
    helper.value = text;
    helper.setAttribute('readonly', '');
    helper.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.append(helper);
    helper.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch (error) {
      copied = false;
    }
    helper.remove();
    return copied;
  }

  async function copyOutput() {
    if (!state.output) {
      showToast('Nothing to copy yet. Format or minify first.', 'error');
      return;
    }
    const copied = await writeToClipboard(state.output);
    if (copied) {
      showToast('Output copied to clipboard');
    } else {
      showToast('Copy failed. Select the output and copy it manually.', 'error');
    }
  }

  function downloadOutput() {
    if (!state.output) {
      showToast('Nothing to download yet. Format or minify first.', 'error');
      return;
    }
    const filename = state.outputMode === 'minify' ? 'minified.json' : 'formatted.json';
    const url = URL.createObjectURL(new Blob([state.output], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`Downloaded ${filename}`);
  }

  function clearAll() {
    el.input.value = '';
    state.parseCache = null;
    clearOutput();
    hideError();
    resetStatus();
    dismissToast();
    updateInputStats();
    el.input.focus();
  }

  function loadExample() {
    // Compact on purpose, so Format has something visible to do.
    el.input.value = JSON.stringify(EXAMPLE_DOCUMENT);
    handleInputChange();
    el.input.focus();
    el.input.setSelectionRange(0, 0);
    el.input.scrollTop = 0;
    el.input.scrollLeft = 0;
  }

  function goToError() {
    if (state.errorIndex === null) return;
    const { line } = lineColumnFromIndex(el.input.value, state.errorIndex);
    const lineHeight = parseFloat(getComputedStyle(el.input).lineHeight) || 20;
    el.input.focus();
    el.input.setSelectionRange(state.errorIndex, Math.min(state.errorIndex + 1, el.input.value.length));
    el.input.scrollTop = Math.max(0, (line - 1) * lineHeight - el.input.clientHeight / 2);
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------
  const actions = {
    format: runFormat,
    minify: runMinify,
    validate: runValidate,
    copy: copyOutput,
    download: downloadOutput,
    clear: clearAll,
    example: loadExample,
  };

  function handleInputChange() {
    // A previous result no longer describes the current text.
    hideError();
    resetStatus();
    if (state.statsFrame === null) {
      state.statsFrame = window.requestAnimationFrame(() => {
        state.statsFrame = null;
        updateInputStats();
      });
    }
  }

  function handleIndentChange() {
    // Keep a visible formatted result in sync with the selected indentation.
    if (state.outputMode === 'format') runFormat();
  }

  function handleKeydown(event) {
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key === 'Enter') {
      event.preventDefault();
      runFormat();
    } else if (modifier && event.shiftKey && event.key.toLowerCase() === 'c') {
      if (!state.output) return; // Leave the browser shortcut alone
      event.preventDefault();
      copyOutput();
    } else if (event.key === 'Escape') {
      dismissToast();
    }
  }

  function init() {
    document.querySelector('.toolbar').addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (button && !button.disabled) actions[button.dataset.action]();
    });
    document.querySelector('[data-action="example"]').addEventListener('click', loadExample);
    document.querySelectorAll('input[name="indent"]').forEach((radio) => radio.addEventListener('change', handleIndentChange));
    el.input.addEventListener('input', handleInputChange);
    el.errorGoto.addEventListener('click', goToError);
    document.addEventListener('keydown', handleKeydown);

    const isApple = /Mac|iPhone|iPad/.test(navigator.userAgent);
    const modKey = isApple ? 'Cmd' : 'Ctrl';
    document.querySelectorAll('.mod').forEach((node) => { node.textContent = modKey; });
    document.querySelector('[data-action="format"]').title = `Format (${modKey}+Enter)`;
    el.copyButton.title = `Copy output (${modKey}+Shift+C)`;
    document.querySelector('[data-action="download"]').title = 'Download output as a .json file';
    document.querySelector('[data-action="minify"]').title = 'Remove all unnecessary whitespace';
    document.querySelector('[data-action="validate"]').title = 'Check whether the input is valid JSON';

    updateInputStats();
    renderOutput();
  }

  init();
})();
