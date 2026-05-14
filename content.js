/* =========================================================
   Kompleter — content script
   Handles: input tracking, Ctrl+Space trigger, ghost text
   ========================================================= */

(function () {
  'use strict';

  let activeInput = null;
  let ghostEl = null;          // the DOM element showing suggestion
  let currentSuggestion = '';  // pending suggestion text
  let pendingRequest = 0;      // incremented per request to cancel stale ones
  let isLoading = false;

  // ── Per-site settings cache ─────────────────────────────
  let siteEnabled = false;
  let siteContextSelector = '';

  const siteKey = `site:${window.location.hostname}`;

  chrome.storage.local.get(siteKey, result => {
    const s = result[siteKey] || {};
    siteEnabled = s.enabled || false;
    siteContextSelector = s.contextSelector || '';
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[siteKey]) {
      const s = changes[siteKey].newValue || {};
      siteEnabled = s.enabled || false;
      siteContextSelector = s.contextSelector || '';
    }
  });

  // ── Input tracking ─────────────────────────────────────

  document.addEventListener('focusin', e => {
    if (isEditable(e.target)) {
      activeInput = e.target;
      dismiss();
    }
  }, true);

  document.addEventListener('focusout', e => {
    if (e.target === activeInput) {
      // Delay so Tab keydown fires before blur clears the suggestion
      setTimeout(() => {
        if (document.activeElement !== activeInput) dismiss();
      }, 150);
    }
  }, true);

  // ── Keyboard handling ───────────────────────────────────

  document.addEventListener('keydown', e => {
    // Ctrl+Space → trigger completion
    if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.code === 'Space') {
      if (activeInput) {
        e.preventDefault();
        e.stopPropagation();
        triggerCompletion();
      }
      return;
    }

    if (!currentSuggestion) return;

    if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      accept();
      return;
    }

    // Any editing/navigation key dismisses the ghost text
    if (
      e.key === 'Escape' ||
      e.key.length === 1 ||
      ['Backspace', 'Delete', 'Enter', 'ArrowLeft', 'ArrowRight',
        'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)
    ) {
      dismiss();
    }
  }, true);

  // Dismiss on scroll (overlay position becomes stale)
  document.addEventListener('scroll', dismiss, true);
  window.addEventListener('resize', dismiss);

  // ── Core logic ──────────────────────────────────────────

  async function triggerCompletion() {
    if (isLoading || !siteEnabled) return;

    const input = activeInput;
    const ctx = getContext(input);
    if (!ctx.trim()) return;

    const reqId = ++pendingRequest;
    isLoading = true;
    dismiss();
    showSpinner(input);

    const pageCtx = getPageContext(input, siteContextSelector);

    let result;
    try {
      result = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { action: 'complete', contextString: ctx, pageContext: pageCtx },
          res => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(res);
          }
        );
      });
    } catch (err) {
      result = { success: false, error: err.message };
    } finally {
      isLoading = false;
    }

    // Ignore stale responses (user triggered another request)
    if (reqId !== pendingRequest) return;

    dismiss();

    if (!result.success) {
      showError(input, result.error);
      return;
    }

    if (result.text) {
      currentSuggestion = result.text;
      renderGhost(input, ctx, result.text);
    }
  }

  function accept() {
    if (!activeInput || !currentSuggestion) return;
    const suggestion = currentSuggestion;
    dismiss();

    if (activeInput.isContentEditable) {
      insertAtCursor(suggestion);
    } else {
      const pos = activeInput.selectionStart;
      const val = activeInput.value;
      activeInput.value = val.slice(0, pos) + suggestion + val.slice(pos);
      const newPos = pos + suggestion.length;
      activeInput.setSelectionRange(newPos, newPos);
      activeInput.dispatchEvent(new Event('input', { bubbles: true }));
      activeInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function dismiss() {
    if (ghostEl) {
      ghostEl.remove();
      ghostEl = null;
    }
    currentSuggestion = '';
  }

  // ── Ghost text rendering ─────────────────────────────────

  /**
   * Renders a transparent mirror-div over the input with:
   *   - invisible typed text (to push cursor position)
   *   - semi-transparent suggestion text after it
   */
  function renderGhost(input, typed, suggestion) {
    if (input.isContentEditable) {
      renderGhostCE(suggestion);
      return;
    }

    const rect = input.getBoundingClientRect();
    const cs = window.getComputedStyle(input);
    const isTextarea = input.tagName === 'TEXTAREA';

    const wrap = document.createElement('div');
    wrap.className = 'kompleter-ghost';

    // Copy all text-rendering styles from the real input
    [
      'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant',
      'letterSpacing', 'lineHeight', 'textTransform', 'wordSpacing',
      'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
      'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
      'boxSizing', 'tabSize', 'direction',
    ].forEach(p => { wrap.style[p] = cs[p]; });

    wrap.style.position = 'fixed';
    wrap.style.top    = rect.top + 'px';
    wrap.style.left   = rect.left + 'px';
    wrap.style.width  = rect.width + 'px';
    wrap.style.height = rect.height + 'px';
    wrap.style.overflow = 'hidden';
    wrap.style.pointerEvents = 'none';
    wrap.style.zIndex = '2147483647';
    wrap.style.color = 'transparent';
    wrap.style.background = 'transparent';
    wrap.style.borderColor = 'transparent';
    wrap.style.whiteSpace = isTextarea ? 'pre-wrap' : 'pre';
    wrap.style.wordBreak = isTextarea ? cs.wordBreak : 'normal';

    const typedSpan = document.createElement('span');
    typedSpan.textContent = typed;
    typedSpan.style.color = 'transparent';

    const suggSpan = document.createElement('span');
    suggSpan.className = 'kompleter-suggestion';
    suggSpan.textContent = suggestion;
    suggSpan.style.color = colorWithOpacity(cs.color, 0.45);

    wrap.appendChild(typedSpan);
    wrap.appendChild(suggSpan);
    document.body.appendChild(wrap);
    ghostEl = wrap;

    // Sync scroll so the suggestion aligns with the real cursor
    if (isTextarea) {
      wrap.scrollTop = input.scrollTop;
      wrap.scrollLeft = input.scrollLeft;
    } else {
      // Single-line: shift by scroll offset
      typedSpan.style.marginLeft = '-' + input.scrollLeft + 'px';
    }
  }

  /** For contenteditable: insert a non-editable ghost span at the cursor */
  function renderGhostCE(suggestion) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;

    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(true);

    const inputColor = activeInput
      ? window.getComputedStyle(activeInput).color
      : 'rgb(0,0,0)';

    const span = document.createElement('span');
    span.className = 'kompleter-ghost kompleter-ghost-ce';
    span.contentEditable = 'false';
    span.textContent = suggestion;
    span.style.color = colorWithOpacity(inputColor, 0.45);
    range.insertNode(span);

    ghostEl = span;
  }

  // ── UI helpers ───────────────────────────────────────────

  function showSpinner(input) {
    const rect = input.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'kompleter-spinner';
    el.textContent = '●';
    el.style.top  = (rect.top + rect.height / 2 - 8) + 'px';
    el.style.left = (rect.right + 6) + 'px';
    document.body.appendChild(el);
    ghostEl = el;
  }

  function showError(input, msg) {
    const rect = input.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'kompleter-error';
    el.textContent = '⚠ ' + msg;
    el.style.top  = (rect.bottom + 4) + 'px';
    el.style.left = rect.left + 'px';
    document.body.appendChild(el);
    ghostEl = el;
    setTimeout(dismiss, 5000);
  }

  // ── Utilities ─────────────────────────────────────────────

  /** Parse a computed rgb/rgba color string and return it at the given alpha. */
  function colorWithOpacity(color, alpha) {
    const m = color.match(/[\d.]+/g);
    if (!m || m.length < 3) return `rgba(0,0,0,${alpha})`;
    return `rgba(${m[0]},${m[1]},${m[2]},${alpha})`;
  }

  /**
   * Extract page context text (up to 3000 chars) near the active input.
   * If selector is provided, grabs text from that element.
   * Otherwise walks up the DOM collecting preceding sibling text.
   */
  function getPageContext(input, selector) {
    const MAX_CHARS = 3000;
    try {
      if (selector) {
        const el = document.querySelector(selector);
        if (el) return el.innerText.slice(-MAX_CHARS).trim();
      }
      return domTraversalContext(input, MAX_CHARS);
    } catch (_) {
      return '';
    }
  }

  /**
   * Walk up the DOM from input, collecting visible text from preceding
   * siblings at each ancestor level. Returns the last MAX_CHARS characters.
   */
  function domTraversalContext(input, maxChars) {
    const parts = [];
    let totalLen = 0;
    let el = input;
    let depth = 0;

    while (el.parentElement && el.parentElement !== document.body && depth < 12) {
      const parent = el.parentElement;
      for (const child of parent.children) {
        if (child === el) break;
        // Skip script/style/invisible elements
        if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(child.tagName)) continue;
        const cs = window.getComputedStyle(child);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const text = child.innerText?.trim();
        if (text) {
          parts.push(text);
          totalLen += text.length;
        }
      }
      el = parent;
      depth++;
      if (totalLen >= maxChars) break;
    }

    return parts.join('\n').slice(-maxChars).trim();
  }

  function isEditable(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === 'TEXTAREA') return !el.readOnly && !el.disabled;
    if (el.tagName === 'INPUT') {
      const t = (el.type || 'text').toLowerCase();
      if (['password', 'file', 'checkbox', 'radio', 'button', 'submit',
           'reset', 'image', 'range', 'color', 'date', 'datetime-local',
           'month', 'time', 'week', 'number'].includes(t)) return false;
      return !el.readOnly && !el.disabled;
    }
    return false;
  }

  function getContext(el) {
    if (!el) return '';
    if (el.isContentEditable) {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return el.innerText || '';
      const range = sel.getRangeAt(0).cloneRange();
      const before = document.createRange();
      before.selectNodeContents(el);
      before.setEnd(range.startContainer, range.startOffset);
      return before.toString();
    }
    return el.value.slice(0, el.selectionStart);
  }

  function insertAtCursor(text) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

})();
