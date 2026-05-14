'use strict';

const DEFAULT_PROMPT =
  'You are an intelligent autocomplete assistant. ' +
  'Complete the following text naturally and concisely. ' +
  'Return ONLY the completion — the part that comes AFTER the existing text — ' +
  'with no explanation, no quotes, and no repetition of the input. ' +
  'If the text appears complete, return an empty string.\n\n' +
  '{{page_context}}' +
  'Text to complete:\n```\n{{context_string}}\n```';

const MODELS_CACHE_KEY = 'modelsCache';
const MODELS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MODELS_API = 'https://openrouter.ai/api/v1/models';

// ── Elements ─────────────────────────────────────────────
const apiKeyEl          = document.getElementById('apiKey');
const toggleKeyEl       = document.getElementById('toggleKey');
const modelSearchEl     = document.getElementById('modelSearch');
const modelListEl       = document.getElementById('modelList');
const modelStatusEl     = document.getElementById('modelStatus');
const modelSelectedEl   = document.getElementById('modelSelectedId');
const refreshModelsEl   = document.getElementById('refreshModels');
const tempEl            = document.getElementById('temperature');
const tempValueEl       = document.getElementById('tempValue');
const maxTokensEl       = document.getElementById('maxTokens');
const mainPromptEl      = document.getElementById('mainPrompt');
const resetPromptEl     = document.getElementById('resetPrompt');
const contextSelectorEl = document.getElementById('contextSelector');
const siteHostnameEl    = document.getElementById('siteHostname');
const siteEnabledEl     = document.getElementById('siteEnabled');
const toggleLabelEl     = document.getElementById('toggleLabel');
const saveBtnEl         = document.getElementById('saveBtn');
const savedMsgEl        = document.getElementById('savedMsg');

// ── State ────────────────────────────────────────────────
let allModels = [];
let selectedModel = 'openai/gpt-4o-mini';
let currentHostname = null;

// ── Init ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Get current tab hostname
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      try { currentHostname = new URL(tab.url).hostname; } catch (_) {}
    }
  } catch (_) {}

  siteHostnameEl.textContent = currentHostname || '(unknown)';

  // Load per-site settings
  if (currentHostname) {
    const siteKey = `site:${currentHostname}`;
    const siteData = await chrome.storage.local.get(siteKey);
    const site = siteData[siteKey] || {};
    siteEnabledEl.checked = site.enabled || false;
    contextSelectorEl.value = site.contextSelector || '';
    updateToggleLabel(siteEnabledEl.checked);
  }

  // Load global settings
  const s = await chrome.storage.sync.get({
    apiKey:      '',
    model:       'openai/gpt-4o-mini',
    mainPrompt:  DEFAULT_PROMPT,
    temperature: 0.3,
    maxTokens:   150,
  });

  apiKeyEl.value = s.apiKey;
  mainPromptEl.value = s.mainPrompt;
  tempEl.value = s.temperature;
  tempValueEl.textContent = Number(s.temperature).toFixed(2);
  maxTokensEl.value = s.maxTokens;

  selectedModel = s.model;
  modelSelectedEl.textContent = selectedModel;

  await loadModels(false);
});

// ── Site toggle ───────────────────────────────────────────

function updateToggleLabel(enabled) {
  toggleLabelEl.textContent = enabled ? 'Enabled' : 'Disabled';
  toggleLabelEl.className = 'toggle-label' + (enabled ? ' on' : '');
}

siteEnabledEl.addEventListener('change', () => {
  updateToggleLabel(siteEnabledEl.checked);
  saveSiteSettings();
});

contextSelectorEl.addEventListener('change', () => saveSiteSettings());

async function saveSiteSettings() {
  if (!currentHostname) return;
  await chrome.storage.local.set({
    [`site:${currentHostname}`]: {
      enabled:         siteEnabledEl.checked,
      contextSelector: contextSelectorEl.value.trim(),
    },
  });
}


// ── Model loading ─────────────────────────────────────────

async function loadModels(forceRefresh) {
  modelStatusEl.textContent = 'Loading models…';
  modelListEl.innerHTML = '';
  refreshModelsEl.disabled = true;

  try {
    allModels = await fetchModels(forceRefresh);
    renderModelList(modelSearchEl.value.trim());
  } catch (err) {
    modelStatusEl.textContent = '⚠ Failed to load models: ' + err.message;
  } finally {
    refreshModelsEl.disabled = false;
  }
}

async function fetchModels(forceRefresh) {
  // Check local cache first
  if (!forceRefresh) {
    const cached = await chrome.storage.local.get(MODELS_CACHE_KEY);
    const entry = cached[MODELS_CACHE_KEY];
    if (entry && Date.now() - entry.ts < MODELS_TTL_MS && entry.models?.length) {
      return entry.models;
    }
  }

  const resp = await fetch(MODELS_API);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();

  const models = (json.data || [])
    .map(m => ({
      id:     m.id,
      name:   m.name || m.id,
      isFree: m.pricing?.prompt === '0' && m.pricing?.completion === '0',
    }))
    .sort((a, b) => {
      // Free models first, then alphabetically by name
      if (a.isFree !== b.isFree) return a.isFree ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  await chrome.storage.local.set({ [MODELS_CACHE_KEY]: { ts: Date.now(), models } });
  return models;
}

// ── Model list rendering ──────────────────────────────────

function renderModelList(query) {
  const q = query.toLowerCase().trim();
  const filtered = q
    ? allModels.filter(m =>
        m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
      )
    : allModels;

  modelListEl.innerHTML = '';

  if (!filtered.length) {
    modelStatusEl.textContent = 'No models match your search.';
    return;
  }

  // Clamp render count for performance; user can refine search
  const MAX_RENDER = 200;
  const toRender = filtered.slice(0, MAX_RENDER);

  const frag = document.createDocumentFragment();
  for (const m of toRender) {
    frag.appendChild(makeModelItem(m));
  }
  modelListEl.appendChild(frag);

  const extra = filtered.length - toRender.length;
  modelStatusEl.textContent =
    extra > 0
      ? `Showing ${toRender.length} of ${filtered.length} — refine search to see more`
      : `${filtered.length} model${filtered.length !== 1 ? 's' : ''}`;

  scrollToSelected();
}

function makeModelItem(m) {
  const el = document.createElement('div');
  el.className = 'model-item' + (m.id === selectedModel ? ' selected' : '');
  el.dataset.id = m.id;

  const nameEl = document.createElement('span');
  nameEl.className = 'model-item-name';
  nameEl.textContent = m.name;

  const idEl = document.createElement('span');
  idEl.className = 'model-item-id';
  idEl.textContent = m.id;

  el.appendChild(nameEl);
  el.appendChild(idEl);

  if (m.isFree) {
    const badge = document.createElement('span');
    badge.className = 'badge-free';
    badge.textContent = 'FREE';
    el.appendChild(badge);
  }

  el.addEventListener('click', () => selectModel(m.id));
  return el;
}

function selectModel(id) {
  selectedModel = id;
  modelSelectedEl.textContent = id;
  // Update highlight in list
  modelListEl.querySelectorAll('.model-item').forEach(el => {
    el.classList.toggle('selected', el.dataset.id === id);
  });
}

function scrollToSelected() {
  const sel = modelListEl.querySelector('.model-item.selected');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

// ── Search ────────────────────────────────────────────────

let searchTimer = null;
modelSearchEl.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => renderModelList(modelSearchEl.value.trim()), 150);
});

// ── Refresh ───────────────────────────────────────────────

refreshModelsEl.addEventListener('click', () => loadModels(true));

// ── Toggle API key visibility ─────────────────────────────

toggleKeyEl.addEventListener('click', () => {
  const isHidden = apiKeyEl.type === 'password';
  apiKeyEl.type = isHidden ? 'text' : 'password';
  toggleKeyEl.textContent = isHidden ? '🙈' : '👁';
});

// ── Temperature display ───────────────────────────────────

tempEl.addEventListener('input', () => {
  tempValueEl.textContent = Number(tempEl.value).toFixed(2);
});

// ── Reset prompt ──────────────────────────────────────────

resetPromptEl.addEventListener('click', () => {
  mainPromptEl.value = DEFAULT_PROMPT;
});

// ── Save ──────────────────────────────────────────────────

saveBtnEl.addEventListener('click', async () => {
  if (!selectedModel) {
    modelSearchEl.focus();
    return;
  }

  await chrome.storage.sync.set({
    apiKey:      apiKeyEl.value.trim(),
    model:       selectedModel,
    mainPrompt:  mainPromptEl.value,
    temperature: parseFloat(tempEl.value),
    maxTokens:   parseInt(maxTokensEl.value, 10),
  });

  savedMsgEl.classList.remove('hidden');
  setTimeout(() => savedMsgEl.classList.add('hidden'), 2500);
});
