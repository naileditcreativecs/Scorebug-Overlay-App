'use strict';

const api = window.overlayControl;
const editor = document.getElementById('editor');
const outputBox = document.getElementById('output-box');
const toastOutput = document.getElementById('toast');
const teamPanel = document.getElementById('team-panel');
const instructions = document.getElementById('instructions');

let appState = null;
let activeView = 'resize';
let gesture = null;
let pointerFrame = null;
let pendingPointer = null;
let queuedState = null;
let ipcQueue = [];
let ipcRunning = false;
let toastTimer = null;
let teamUpdateRunning = false;
let pickerTarget = null;
const logoSliderActive = new Set();
const logoPreviewFrames = new Map();
const pendingLogoPreviews = new Map();
const logoCaptures = new Map();
const logoCaptureRunning = new Set();
const deleteConfirmTimers = new Map();
let logoPreviewGesture = null;
let logoDirectGesture = null;
let logoNumberPadTarget = null;
let logoNumberPadValue = '';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function setToast(message, error = false) {
  clearTimeout(toastTimer);
  toastOutput.textContent = String(message || '');
  toastOutput.classList.toggle('visible', Boolean(message));
  toastOutput.classList.toggle('error', Boolean(error));
  if (message) toastTimer = setTimeout(() => setToast(''), error ? 6000 : 2600);
}

function reportError(error) {
  setToast(error?.message || String(error || 'The resize action failed.'), true);
}

function describeTeam(team) {
  if (!team?.name) return 'waiting';
  const rank = Number(team.rank);
  const record = team.record ? ` · ${team.record}` : '';
  return `${Number.isInteger(rank) && rank > 0 ? `#${rank} ` : ''}${team.name}${record}`;
}

function teamNameForId(teamId) {
  if (!teamId) return 'Auto (OCR)';
  return appState?.teams?.find((team) => String(team.id) === String(teamId))?.name || 'Auto (OCR)';
}

function rankLabel(override) {
  if (override?.rankMode === 'unranked') return 'Unranked';
  if (override?.rankMode === 'ranked') return `#${override.rank}`;
  return 'Auto (OCR)';
}

function logoChoiceState(side) {
  return appState?.logoChoices?.[side] || {
    teamId: null,
    teamName: null,
    defaultLabel: null,
    selectedVariantId: null,
    choices: [],
  };
}

function logoLabel(side) {
  const state = logoChoiceState(side);
  if (!state.teamId) return 'Waiting for team';
  if (!state.choices?.length) return 'No logo installed';
  const selected = state.choices.find((choice) => choice.id === state.activeVariantId);
  return selected?.label || state.defaultLabel || 'Current logo';
}

function activeLogoChoice(side) {
  const state = logoChoiceState(side);
  return state.choices?.find((choice) => choice.id === state.activeVariantId)
    || state.choices?.find((choice) => choice.id === 'default')
    || null;
}

function activeLogoCapture(side) {
  const capture = logoCaptures.get(side);
  const state = logoChoiceState(side);
  if (!capture || !state.teamId) return null;
  if (String(capture.teamId) !== String(state.teamId)) return null;
  if (String(capture.variantId) !== String(state.activeVariantId || 'default')) return null;
  return capture;
}

function paintLogoGeometry(side) {
  const geometry = appState?.logoGeometry?.[side];
  const label = document.getElementById(`${side}-logo-geometry`);
  if (!label) return;
  label.textContent = geometry && Number(geometry.width) > 0 && Number(geometry.height) > 0
    ? `Live X ${Math.round(geometry.x)} · Y ${Math.round(geometry.y)} · ${Math.round(geometry.width)}×${Math.round(geometry.height)} px`
    : 'Waiting for live logo position';
}

function paintLogoPreview(side, transform) {
  const preview = document.getElementById(`${side}-logo-preview`);
  const image = document.getElementById(`${side}-logo-preview-image`);
  const captureImage = document.getElementById(`${side}-logo-capture`);
  const captureMarker = document.getElementById(`${side}-logo-capture-marker`);
  const choice = activeLogoChoice(side);
  const capture = activeLogoCapture(side);
  const disabled = !logoChoiceState(side).teamId || !choice?.logo;
  preview.classList.toggle('disabled', disabled);
  preview.classList.toggle('has-capture', Boolean(capture?.image));
  document.getElementById(`${side}-restore-logo-defaults`).disabled = disabled;
  if (disabled) {
    image.removeAttribute('src');
    captureImage.removeAttribute('src');
    return;
  }
  if (image.getAttribute('src') !== choice.logo) image.setAttribute('src', choice.logo);
  if (capture?.image && capture.width > 0 && capture.height > 0 && capture.logoBounds) {
    if (captureImage.getAttribute('src') !== capture.image) captureImage.setAttribute('src', capture.image);
    const previewWidth = Math.max(1, preview.clientWidth || 1);
    const previewHeight = Math.max(1, preview.clientHeight || 1);
    const fit = Math.min(previewWidth / capture.width, previewHeight / capture.height);
    const offsetX = (previewWidth - (capture.width * fit)) / 2;
    const offsetY = (previewHeight - (capture.height * fit)) / 2;
    const box = capture.logoBounds;
    const capturedCenterX = offsetX + ((Number(box.x) + (Number(box.width) / 2)) * fit);
    const capturedCenterY = offsetY + ((Number(box.y) + (Number(box.height) / 2)) * fit);
    const baseline = capture.transform || { x: 0, y: 0, scale: 1, rotation: 0 };
    const outerScale = Math.max(0.1, Number(capture.overlayScale) || 1);
    const scaleRatio = Math.max(0.05, Number(transform.scale) || 1)
      / Math.max(0.05, Number(baseline.scale) || 1);
    const centerX = capturedCenterX + ((Number(transform.x) - Number(baseline.x || 0)) * outerScale * fit);
    const centerY = capturedCenterY + ((Number(transform.y) - Number(baseline.y || 0)) * outerScale * fit);
    const width = Math.max(4, Number(box.width) * fit * scaleRatio);
    const height = Math.max(4, Number(box.height) * fit * scaleRatio);
    captureMarker.style.left = `${offsetX + (Number(box.x) * fit)}px`;
    captureMarker.style.top = `${offsetY + (Number(box.y) * fit)}px`;
    captureMarker.style.width = `${Math.max(4, Number(box.width) * fit)}px`;
    captureMarker.style.height = `${Math.max(4, Number(box.height) * fit)}px`;
    image.style.left = `${centerX}px`;
    image.style.top = `${centerY}px`;
    image.style.width = `${width}px`;
    image.style.height = `${height}px`;
    image.style.margin = '0';
    image.style.transform = `translate(-50%, -50%) rotate(${Number(transform.rotation) - Number(baseline.rotation || 0)}deg)`;
  } else {
    captureImage.removeAttribute('src');
    captureMarker.removeAttribute('style');
    image.style.left = '50%';
    image.style.top = '50%';
    image.style.width = '64px';
    image.style.height = '64px';
    image.style.margin = '-32px 0 0 -32px';
    image.style.transform = `translate(${transform.x}px, ${transform.y}px) rotate(${transform.rotation}deg) scale(${transform.scale})`;
  }
}

function renderLogoTransform(side) {
  const state = logoChoiceState(side);
  const choice = activeLogoChoice(side);
  const transform = state.transform || { x: 0, y: 0, scale: 1.13, rotation: 0 };
  const disabled = !state.teamId || !choice;
  const values = {
    x: Number(transform.x) || 0,
    y: Number(transform.y) || 0,
    scale: Math.round((Number(transform.scale) || 1.13) * 100),
    rotation: Number(transform.rotation) || 0,
  };
  for (const [field, value] of Object.entries(values)) {
    const input = document.getElementById(`${side}-logo-${field}`);
    const numberInput = document.getElementById(`${side}-logo-${field}-number`);
    input.disabled = disabled;
    numberInput.disabled = disabled;
    if (!logoSliderActive.has(side)) {
      input.value = String(value);
      numberInput.value = String(value);
    }
    const displayed = Number(input.value);
    document.getElementById(`${side}-logo-${field}-value`).textContent = field === 'scale'
      ? `${Math.round(displayed)}%`
      : (field === 'rotation' ? `${Math.round(displayed)}°` : `${Math.round(displayed)}px`);
  }
  const captureButton = document.getElementById(`${side}-capture-logo`);
  captureButton.disabled = disabled || logoCaptureRunning.has(side);
  captureButton.textContent = logoCaptureRunning.has(side) ? 'Capturing…' : 'Capture scorebug view';
  document.getElementById(`${side}-reset-logo-transform`).disabled = disabled;
  const importButton = document.getElementById(`${side}-import-logo`);
  importButton.disabled = !state.teamId;
  const deleteButton = document.getElementById(`${side}-delete-logo`);
  deleteButton.classList.toggle('hidden', !choice?.custom);
  if (!deleteButton.dataset.confirmDelete) deleteButton.textContent = 'Delete imported';
  const trimInfo = document.getElementById(`${side}-logo-trim-info`);
  if (trimInfo) {
    const originalWidth = Math.round(Number(choice?.originalWidth) || 0);
    const originalHeight = Math.round(Number(choice?.originalHeight) || 0);
    const width = Math.round(Number(choice?.width) || 0);
    const height = Math.round(Number(choice?.height) || 0);
    trimInfo.textContent = choice?.trimmed && originalWidth && originalHeight && width && height
      ? `Auto-cropped ${originalWidth}×${originalHeight} → ${width}×${height}`
      : (choice ? 'Canvas already tight' : 'Saved for this HTML');
  }
  paintLogoPreview(side, {
    x: values.x,
    y: values.y,
    scale: values.scale / 100,
    rotation: values.rotation,
  });
  paintLogoGeometry(side);
}

function renderTeamControls() {
  for (const side of ['away', 'home']) {
    const override = appState?.teamOverrides?.[side] || {};
    const logoState = logoChoiceState(side);
    document.getElementById(`${side}-team`).textContent = teamNameForId(override.teamId);
    document.getElementById(`${side}-rank`).textContent = rankLabel(override);
    const logoButton = document.getElementById(`${side}-logo`);
    logoButton.textContent = logoLabel(side);
    logoButton.disabled = !logoState.teamId || !logoState.choices?.length;
    const currentLogo = document.getElementById(`${side}-current-logo`);
    const activeChoice = activeLogoChoice(side);
    if (activeChoice?.logo) currentLogo.setAttribute('src', activeChoice.logo);
    else currentLogo.removeAttribute('src');
    const recordInput = document.getElementById(`${side}-record-input`);
    if (recordInput && document.activeElement !== recordInput) {
      recordInput.value = override.recordMode === 'custom' ? (override.record || '') : '';
      recordInput.placeholder = override.recordMode === 'hidden'
        ? 'Hidden'
        : (appState?.scoreboard?.[side]?.record
          ? `Auto (${appState.scoreboard[side].record})`
          : 'Auto');
    }
    const recordMode = override.recordMode || 'auto';
    document.getElementById(`${side}-record-apply`)?.classList.toggle('active', recordMode === 'custom');
    document.getElementById(`${side}-record-auto`)?.classList.toggle('active', recordMode === 'auto');
    document.getElementById(`${side}-record-hide`)?.classList.toggle('active', recordMode === 'hidden');
    const overridden = Boolean(
      override.teamId
      || (override.rankMode && override.rankMode !== 'auto')
      || ['custom', 'hidden'].includes(override.recordMode)
      || logoState.selectedVariantId,
    );
    document.querySelector(`.team-card[data-side="${side}"]`).classList.toggle('overridden', overridden);
    document.getElementById(`${side}-output`).textContent = `Output: ${describeTeam(appState?.scoreboard?.[side])}`;
    document.getElementById(`${side}-reader`).textContent = `OCR currently: ${describeTeam(appState?.readerScoreboard?.[side])}`;
    renderLogoTransform(side);
  }
  const mode = String(appState?.readerMode || 'local-ocr');
  document.getElementById('reader-mode').textContent = mode === 'local-ocr'
    ? 'Automatic OCR remains active'
    : `Reader mode: ${mode}`;
  renderScorebugColors();
}

function renderScorebugColors() {
  const colors = appState?.scorebugColors;
  if (!colors) return;
  for (const side of ['away', 'home']) {
    const choice = colors[side] || { mode: 'auto', color: null };
    const swatches = colors.swatches?.[side] || {};
    const autoButton = document.getElementById(`${side}-color-auto`);
    const secondaryButton = document.getElementById(`${side}-color-secondary`);
    const whiteButton = document.getElementById(`${side}-color-white`);
    const blackButton = document.getElementById(`${side}-color-black`);
    const wheel = document.getElementById(`${side}-color-wheel`);
    if (!autoButton || !wheel) return;
    // The 1st swatch previews the team's real primary; the 2nd its secondary.
    autoButton.style.background = swatches.primary || swatches.live || '#555';
    if (swatches.secondary) {
      secondaryButton.style.background = swatches.secondary;
      secondaryButton.disabled = false;
      secondaryButton.title = "Team's 2nd color";
    } else {
      secondaryButton.style.background = '#333';
      secondaryButton.disabled = true;
      secondaryButton.title = 'This team has no bundled 2nd color yet';
    }
    const active = choice.mode === 'custom' ? choice.color : null;
    autoButton.classList.toggle('active', choice.mode !== 'custom');
    secondaryButton.classList.toggle('active', Boolean(active && active === swatches.secondary));
    whiteButton.classList.toggle('active', active === '#ffffff');
    blackButton.classList.toggle('active', active === '#000000');
    const wheelActive = Boolean(active
      && active !== swatches.secondary && active !== '#ffffff' && active !== '#000000');
    wheel.parentElement.classList.toggle('active', wheelActive);
    if (active) wheel.value = active;
    else if (swatches.live) wheel.value = swatches.live;
  }
  const list = document.getElementById('color-preset-list');
  list.replaceChildren();
  for (const preset of colors.presets || []) {
    const chip = document.createElement('span');
    chip.className = 'color-preset-chip';
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'color-preset-apply';
    apply.title = `Apply ${preset.name}`;
    const awayDot = document.createElement('i');
    awayDot.style.background = preset.away;
    const homeDot = document.createElement('i');
    homeDot.style.background = preset.home;
    apply.append(awayDot, homeDot, document.createTextNode(preset.name));
    apply.addEventListener('click', () => runColorCommand(
      () => api.applyScorebugColorPreset({ name: preset.name }),
      `Preset applied: ${preset.name}`,
    ));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'color-preset-delete';
    remove.textContent = '×';
    remove.title = `Delete ${preset.name}`;
    remove.addEventListener('click', () => runColorCommand(
      () => api.deleteScorebugColorPreset({ name: preset.name }),
      `Preset deleted: ${preset.name}`,
    ));
    chip.append(apply, remove);
    list.append(chip);
  }
}

async function runColorCommand(command, successText) {
  try {
    const next = await command();
    if (next) acceptState(next);
    if (successText) setToast(successText);
  } catch (error) {
    setToast(error?.message || 'Color change failed', true);
    try { acceptState(await api.getInGameEditorState()); } catch { /* Keep the last usable state. */ }
  }
}

function wireRecordControls() {
  // Overrides layer onto live game data; without a game being read there is
  // nothing on screen to show them on. Say so instead of looking dead.
  const savedToast = (message) => {
    const liveGame = Boolean(appState?.scoreboard?.away?.name || appState?.scoreboard?.home?.name);
    setToast(liveGame ? message : `${message} It will appear once the game is being read.`);
  };
  for (const side of ['away', 'home']) {
    const sideLabel = side === 'away' ? 'Away' : 'Home';
    const input = document.getElementById(`${side}-record-input`);
    const applyRecord = async () => {
      const text = input.value.trim();
      if (!text) {
        await applyPickerChoice(side, { recordMode: 'auto', record: null });
        savedToast(`${sideLabel} record returned to automatic.`);
        return;
      }
      if (!/^\d{1,2}-\d{1,2}(?:-\d{1,2})?$/.test(text)) {
        setToast('Records look like 5-2 or 5-2-1', true);
        return;
      }
      await applyPickerChoice(side, { recordMode: 'custom', record: text });
      savedToast(`${sideLabel} record set to ${text}.`);
    };
    document.getElementById(`${side}-record-apply`)?.addEventListener('click', applyRecord);
    input?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); applyRecord(); }
    });
    document.getElementById(`${side}-record-auto`)?.addEventListener('click', async () => {
      input.value = '';
      await applyPickerChoice(side, { recordMode: 'auto', record: null });
      savedToast(`${sideLabel} record returned to automatic.`);
    });
    document.getElementById(`${side}-record-hide`)?.addEventListener('click', async () => {
      input.value = '';
      await applyPickerChoice(side, { recordMode: 'hidden', record: null });
      savedToast(`${sideLabel} record hidden from the scorebug.`);
    });
  }
}

function wireScorebugColorControls() {
  for (const side of ['away', 'home']) {
    const sideLabel = side === 'away' ? 'Away' : 'Home';
    document.getElementById(`${side}-color-auto`)?.addEventListener('click', () => runColorCommand(
      () => api.setScorebugColor({ side, mode: 'auto' }),
      `${sideLabel} color: automatic (team's 1st color)`,
    ));
    document.getElementById(`${side}-color-secondary`)?.addEventListener('click', () => {
      const secondary = appState?.scorebugColors?.swatches?.[side]?.secondary;
      if (!secondary) { setToast('This team has no bundled 2nd color yet', true); return; }
      runColorCommand(
        () => api.setScorebugColor({ side, mode: 'custom', color: secondary }),
        `${sideLabel} color: team's 2nd color`,
      );
    });
    document.getElementById(`${side}-color-white`)?.addEventListener('click', () => runColorCommand(
      () => api.setScorebugColor({ side, mode: 'custom', color: '#ffffff' }),
      `${sideLabel} color: white`,
    ));
    document.getElementById(`${side}-color-black`)?.addEventListener('click', () => runColorCommand(
      () => api.setScorebugColor({ side, mode: 'custom', color: '#000000' }),
      `${sideLabel} color: black`,
    ));
    document.getElementById(`${side}-color-wheel`)?.addEventListener('change', (event) => runColorCommand(
      () => api.setScorebugColor({ side, mode: 'custom', color: event.target.value }),
      `${sideLabel} color: ${event.target.value}`,
    ));
  }
  document.getElementById('save-color-preset')?.addEventListener('click', async () => {
    const nameInput = document.getElementById('color-preset-name');
    await runColorCommand(
      () => api.saveScorebugColorPreset({ name: nameInput.value }),
      'Colors saved as a preset',
    );
    nameInput.value = '';
  });
}

function closeChoicePicker() {
  pickerTarget = null;
  document.getElementById('choice-picker').classList.add('hidden');
  const list = document.getElementById('choice-picker-list');
  list.classList.remove('logo-choice-grid');
  list.replaceChildren();
}

function pickerButton(label, {
  selected = false, auto = false, logo = null, onClick,
} = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  if (logo) {
    button.classList.add('logo-choice');
    const image = document.createElement('img');
    image.src = logo;
    image.alt = '';
    const text = document.createElement('span');
    text.textContent = label;
    button.append(image, text);
  } else {
    button.textContent = label;
  }
  button.classList.toggle('selected', selected);
  button.classList.toggle('auto-choice', auto);
  button.addEventListener('click', onClick);
  return button;
}

async function applyPickerChoice(side, changes) {
  if (teamUpdateRunning) return;
  teamUpdateRunning = true;
  const current = appState?.teamOverrides?.[side] || {};
  try {
    const next = await api.setManualTeamOverride({
      side,
      teamId: Object.hasOwn(changes, 'teamId') ? changes.teamId : (current.teamId || null),
      rankMode: Object.hasOwn(changes, 'rankMode') ? changes.rankMode : (current.rankMode || 'auto'),
      rank: Object.hasOwn(changes, 'rank') ? changes.rank : (current.rank || null),
      recordMode: Object.hasOwn(changes, 'recordMode') ? changes.recordMode : (current.recordMode || 'auto'),
      record: Object.hasOwn(changes, 'record') ? changes.record : (current.record || null),
    });
    acceptState(next);
    closeChoicePicker();
    setToast(`${side === 'away' ? 'Away' : 'Home'} override updated. OCR is still running.`);
  } catch (error) {
    reportError(error);
    try { acceptState(await api.getInGameEditorState()); } catch { /* Keep the last usable state. */ }
  } finally {
    teamUpdateRunning = false;
  }
}

function openTeamPicker(side) {
  closeLogoNumberPad();
  pickerTarget = { side, type: 'team' };
  const current = appState?.teamOverrides?.[side] || {};
  document.getElementById('choice-picker-title').textContent = `Choose ${side === 'away' ? 'away' : 'home'} team`;
  const list = document.getElementById('choice-picker-list');
  list.classList.remove('logo-choice-grid');
  list.replaceChildren();
  list.append(pickerButton('Auto (OCR)', {
    auto: true,
    selected: !current.teamId,
    onClick: () => applyPickerChoice(side, { teamId: null }),
  }));
  for (const team of appState?.teams || []) {
    list.append(pickerButton(team.name, {
      selected: String(current.teamId || '') === String(team.id),
      onClick: () => applyPickerChoice(side, { teamId: String(team.id) }),
    }));
  }
  document.getElementById('choice-picker').classList.remove('hidden');
}

function openRankPicker(side) {
  closeLogoNumberPad();
  pickerTarget = { side, type: 'rank' };
  const current = appState?.teamOverrides?.[side] || {};
  document.getElementById('choice-picker-title').textContent = `Choose ${side === 'away' ? 'away' : 'home'} rank`;
  const list = document.getElementById('choice-picker-list');
  list.classList.remove('logo-choice-grid');
  list.replaceChildren();
  list.append(pickerButton('Auto (OCR)', {
    auto: true,
    selected: !current.rankMode || current.rankMode === 'auto',
    onClick: () => applyPickerChoice(side, { rankMode: 'auto', rank: null }),
  }));
  list.append(pickerButton('Unranked', {
    selected: current.rankMode === 'unranked',
    onClick: () => applyPickerChoice(side, { rankMode: 'unranked', rank: null }),
  }));
  for (let rank = 1; rank <= 25; rank += 1) {
    list.append(pickerButton(`#${rank}`, {
      selected: current.rankMode === 'ranked' && Number(current.rank) === rank,
      onClick: () => applyPickerChoice(side, { rankMode: 'ranked', rank }),
    }));
  }
  document.getElementById('choice-picker').classList.remove('hidden');
}

async function applyLogoChoice(side, teamId, variantId) {
  if (teamUpdateRunning) return;
  teamUpdateRunning = true;
  try {
    const next = await api.setTeamLogoPreference({ side, teamId, variantId });
    logoCaptures.delete(side);
    acceptState(next);
    closeChoicePicker();
    const state = next?.logoChoices?.[side];
    const selected = state?.choices?.find((choice) => choice.id === state.activeVariantId);
    setToast(`${state?.teamName || 'Team'} logo: ${selected?.label || 'Current logo'}. Team OCR is still running.`);
    setTimeout(() => captureLogoPlacement(side, { quiet: true }), 180);
  } catch (error) {
    reportError(error);
    try { acceptState(await api.getInGameEditorState()); } catch { /* Keep the last usable state. */ }
  } finally {
    teamUpdateRunning = false;
  }
}

function openLogoPicker(side) {
  closeLogoNumberPad();
  const state = logoChoiceState(side);
  if (!state.teamId || !state.choices?.length) {
    setToast('Wait for a team with an installed logo to be detected.', true);
    return;
  }
  pickerTarget = { side, type: 'logo' };
  document.getElementById('choice-picker-title').textContent = `Choose ${state.teamName} logo`;
  const list = document.getElementById('choice-picker-list');
  list.replaceChildren();
  list.classList.add('logo-choice-grid');
  for (const choice of state.choices) {
    list.append(pickerButton(choice.label, {
      logo: choice.logo,
      selected: state.activeVariantId === choice.id,
      onClick: () => applyLogoChoice(side, state.teamId, choice.id),
    }));
  }
  document.getElementById('choice-picker').classList.remove('hidden');
}

function readLogoTransform(side) {
  return {
    x: Number(document.getElementById(`${side}-logo-x`).value),
    y: Number(document.getElementById(`${side}-logo-y`).value),
    scale: Number(document.getElementById(`${side}-logo-scale`).value) / 100,
    rotation: Number(document.getElementById(`${side}-logo-rotation`).value),
  };
}

function updateLogoTransformOutputs(side) {
  const transform = readLogoTransform(side);
  document.getElementById(`${side}-logo-x-number`).value = String(Math.round(transform.x));
  document.getElementById(`${side}-logo-y-number`).value = String(Math.round(transform.y));
  document.getElementById(`${side}-logo-scale-number`).value = String(Math.round(transform.scale * 100));
  document.getElementById(`${side}-logo-rotation-number`).value = String(Math.round(transform.rotation));
  document.getElementById(`${side}-logo-x-value`).textContent = `${Math.round(transform.x)}px`;
  document.getElementById(`${side}-logo-y-value`).textContent = `${Math.round(transform.y)}px`;
  document.getElementById(`${side}-logo-scale-value`).textContent = `${Math.round(transform.scale * 100)}%`;
  document.getElementById(`${side}-logo-rotation-value`).textContent = `${Math.round(transform.rotation)}°`;
  paintLogoPreview(side, transform);
  return transform;
}

function setLogoControlValue(side, field, value) {
  const range = document.getElementById(`${side}-logo-${field}`);
  const number = document.getElementById(`${side}-logo-${field}-number`);
  const normalized = clamp(Math.round(Number(value) || 0), Number(range.min), Number(range.max));
  range.value = String(normalized);
  number.value = String(normalized);
  return normalized;
}

async function captureLogoPlacement(side, { quiet = false } = {}) {
  if (logoCaptureRunning.has(side)) return;
  const state = logoChoiceState(side);
  if (!state.teamId || !activeLogoChoice(side)?.logo) return;
  logoCaptureRunning.add(side);
  renderLogoTransform(side);
  try {
    const capture = await api.captureTeamLogoPlacement({
      side,
      teamId: state.teamId,
      variantId: state.activeVariantId || 'default',
    });
    logoCaptures.set(side, capture);
    paintLogoPreview(side, readLogoTransform(side));
    if (!quiet) setToast(`${state.teamName || 'Team'} live logo position captured. The yellow box marks its starting position.`);
  } catch (error) {
    if (!quiet) reportError(error);
  } finally {
    logoCaptureRunning.delete(side);
    renderLogoTransform(side);
  }
}

function scheduleAutomaticLogoCaptures() {
  for (const [index, side] of ['away', 'home'].entries()) {
    if (activeLogoCapture(side)) continue;
    setTimeout(() => {
      if (activeView === 'teams' && appState?.logoGeometry?.[side]) {
        captureLogoPlacement(side, { quiet: true });
      }
    }, 180 + (index * 120));
  }
}

function closeLogoNumberPad() {
  if (logoNumberPadTarget?.side) logoSliderActive.delete(logoNumberPadTarget.side);
  logoNumberPadTarget = null;
  logoNumberPadValue = '';
  document.getElementById('logo-number-pad').classList.add('hidden');
}

function renderLogoNumberPad() {
  document.getElementById('logo-number-pad-display').textContent = logoNumberPadValue || '0';
}

function openLogoNumberPad(side, field) {
  const input = document.getElementById(`${side}-logo-${field}-number`);
  if (!input || input.disabled) return;
  closeChoicePicker();
  logoNumberPadTarget = { side, field };
  logoNumberPadValue = String(input.value || '0');
  const names = { x: 'Left / right', y: 'Up / down', scale: 'Size percent', rotation: 'Rotation' };
  document.getElementById('logo-number-pad-title').textContent = `${side === 'away' ? 'Away' : 'Home'} logo · ${names[field]}`;
  document.getElementById('logo-number-pad').classList.remove('hidden');
  renderLogoNumberPad();
}

function appendLogoNumberDigit(digit) {
  if (!logoNumberPadTarget) return;
  const negative = logoNumberPadValue.startsWith('-');
  const unsigned = negative ? logoNumberPadValue.slice(1) : logoNumberPadValue;
  const next = unsigned === '0' ? digit : `${unsigned}${digit}`;
  logoNumberPadValue = `${negative ? '-' : ''}${next}`.slice(0, 5);
  renderLogoNumberPad();
}

function applyLogoNumberPad() {
  if (!logoNumberPadTarget) return;
  const { side, field } = logoNumberPadTarget;
  logoSliderActive.add(side);
  setLogoControlValue(side, field, Number(logoNumberPadValue || 0));
  closeLogoNumberPad();
  scheduleLogoPreview(side);
  saveLogoTransform(side);
}

function logoTransformRequest(side, transform = readLogoTransform(side)) {
  const state = logoChoiceState(side);
  return {
    side,
    teamId: state.teamId,
    variantId: state.activeVariantId || 'default',
    transform,
  };
}

function scheduleLogoPreview(side) {
  pendingLogoPreviews.set(side, logoTransformRequest(side, updateLogoTransformOutputs(side)));
  if (logoPreviewFrames.has(side)) return;
  const frame = requestAnimationFrame(() => {
    logoPreviewFrames.delete(side);
    const request = pendingLogoPreviews.get(side);
    pendingLogoPreviews.delete(side);
    if (request) api.previewTeamLogoTransform(request).catch(reportError);
  });
  logoPreviewFrames.set(side, frame);
}

async function saveLogoTransform(side) {
  const frame = logoPreviewFrames.get(side);
  if (frame !== undefined) cancelAnimationFrame(frame);
  logoPreviewFrames.delete(side);
  pendingLogoPreviews.delete(side);
  logoSliderActive.delete(side);
  try {
    acceptState(await api.saveTeamLogoTransform(logoTransformRequest(side)));
    setToast(`${logoChoiceState(side).teamName || 'Team'} logo placement saved for this HTML.`);
  } catch (error) {
    reportError(error);
  }
}

async function importLogo(side) {
  if (teamUpdateRunning) return;
  const before = logoChoiceState(side);
  if (!before.teamId) return;
  teamUpdateRunning = true;
  try {
    const next = await api.importTeamLogo({
      side,
      teamId: before.teamId,
      variantId: before.activeVariantId || 'default',
    });
    logoCaptures.delete(side);
    const after = next?.logoChoices?.[side];
    acceptState(next);
    if ((after?.choices?.length || 0) > (before.choices?.length || 0)) {
      setToast(`${after.teamName} logo imported and selected. You can now resize, move, or rotate it.`);
      setTimeout(() => captureLogoPlacement(side, { quiet: true }), 180);
    }
  } catch (error) {
    reportError(error);
  } finally {
    teamUpdateRunning = false;
  }
}

async function deleteImportedLogo(side, button) {
  const state = logoChoiceState(side);
  const choice = activeLogoChoice(side);
  if (!state.teamId || !choice?.custom || teamUpdateRunning) return;
  if (button.dataset.confirmDelete !== choice.id) {
    clearTimeout(deleteConfirmTimers.get(side));
    button.dataset.confirmDelete = choice.id;
    button.textContent = 'Click again to delete';
    deleteConfirmTimers.set(side, setTimeout(() => {
      delete button.dataset.confirmDelete;
      button.textContent = 'Delete imported';
    }, 3500));
    return;
  }
  clearTimeout(deleteConfirmTimers.get(side));
  delete button.dataset.confirmDelete;
  teamUpdateRunning = true;
  try {
    logoCaptures.delete(side);
    acceptState(await api.deleteImportedTeamLogo({
      side,
      teamId: state.teamId,
      variantId: choice.id,
    }));
    setToast(`${state.teamName} imported logo deleted; its default logo is active again.`);
  } catch (error) {
    reportError(error);
  } finally {
    teamUpdateRunning = false;
  }
}

async function restoreLogoDefaults(side) {
  if (teamUpdateRunning) return;
  const state = logoChoiceState(side);
  if (!state.teamId) return;
  teamUpdateRunning = true;
  try {
    if (state.activeVariantId && state.activeVariantId !== 'default') {
      await api.saveTeamLogoTransform({
        side,
        teamId: state.teamId,
        variantId: state.activeVariantId,
        reset: true,
      });
    }
    const automatic = await api.setTeamLogoPreference({
      side,
      teamId: state.teamId,
      variantId: null,
    });
    const restored = await api.saveTeamLogoTransform({
      side,
      teamId: state.teamId,
      variantId: 'default',
      reset: true,
    });
    acceptState(restored || automatic);
    logoCaptures.delete(side);
    setToast(`${state.teamName} restored to its default logo, position, size, and rotation.`);
    setTimeout(() => captureLogoPlacement(side, { quiet: true }), 180);
  } catch (error) {
    reportError(error);
  } finally {
    teamUpdateRunning = false;
  }
}

function beginLogoPreviewDrag(event) {
  const preview = event.currentTarget;
  const side = preview.dataset.side;
  const state = logoChoiceState(side);
  if (!state.teamId || !activeLogoChoice(side)?.logo || logoPreviewGesture) return;
  event.preventDefault();
  event.stopPropagation();
  logoSliderActive.add(side);
  logoPreviewGesture = {
    side,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    logoX: Number(document.getElementById(`${side}-logo-x`).value),
    logoY: Number(document.getElementById(`${side}-logo-y`).value),
  };
  preview.classList.add('is-dragging');
  preview.setPointerCapture?.(event.pointerId);
}

function moveLogoPreview(event) {
  if (!logoPreviewGesture || event.pointerId !== logoPreviewGesture.pointerId) return;
  event.preventDefault();
  const { side } = logoPreviewGesture;
  const xInput = document.getElementById(`${side}-logo-x`);
  const yInput = document.getElementById(`${side}-logo-y`);
  xInput.value = String(clamp(
    Math.round(logoPreviewGesture.logoX + event.clientX - logoPreviewGesture.startX),
    Number(xInput.min),
    Number(xInput.max),
  ));
  yInput.value = String(clamp(
    Math.round(logoPreviewGesture.logoY + event.clientY - logoPreviewGesture.startY),
    Number(yInput.min),
    Number(yInput.max),
  ));
  scheduleLogoPreview(side);
}

function finishLogoPreviewDrag(event) {
  if (!logoPreviewGesture || event.pointerId !== logoPreviewGesture.pointerId) return;
  event.preventDefault();
  const finished = logoPreviewGesture;
  logoPreviewGesture = null;
  const preview = document.getElementById(`${finished.side}-logo-preview`);
  preview.classList.remove('is-dragging');
  preview.releasePointerCapture?.(finished.pointerId);
  saveLogoTransform(finished.side);
}

function setView(view) {
  closeChoicePicker();
  closeLogoNumberPad();
  activeView = view === 'teams' ? 'teams' : 'resize';
  const teams = activeView === 'teams';
  editor.classList.toggle('teams-view', teams);
  teamPanel.classList.toggle('hidden', !teams);
  document.getElementById('view-resize').setAttribute('aria-pressed', String(!teams));
  document.getElementById('view-teams').setAttribute('aria-pressed', String(teams));
  instructions.textContent = teams
    ? 'Drag the outline over the real HTML logo for direct editing, or use the mini preview and sliders for precise changes. Press Ctrl+Alt+O again to close.'
    : 'The game keeps focus. Drag the blue box to move it, or drag an edge/corner to resize. Press Ctrl+Alt+O again to close.';
  renderChrome();
  renderDirectLogoEditors();
  if (teams) scheduleAutomaticLogoCaptures();
}

function runOverlayCommand(command, payload) {
  return command === 'move'
    ? api.moveOverlay(payload)
    : api.resizeOverlay(payload);
}

function pumpIpcQueue() {
  if (ipcRunning || !ipcQueue.length) return;
  ipcRunning = true;
  const item = ipcQueue.shift();
  runOverlayCommand(item.command, item.payload).then(item.resolve, item.reject).finally(() => {
    ipcRunning = false;
    pumpIpcQueue();
  });
}

function enqueueOverlayCommand(command, payload) {
  return new Promise((resolve, reject) => {
    const item = { command, payload, resolve, reject };
    if (payload.phase === 'move') {
      const replaceIndex = ipcQueue.findIndex((queued) => (
        queued.command === command && queued.payload.phase === 'move'
      ));
      if (replaceIndex >= 0) {
        ipcQueue[replaceIndex].resolve(null);
        ipcQueue[replaceIndex] = item;
      } else {
        ipcQueue.push(item);
      }
    } else {
      ipcQueue.push(item);
    }
    pumpIpcQueue();
  });
}

function normalizeCrop(value, canvasWidth, canvasHeight) {
  const width = Math.max(1, Math.round(Number(canvasWidth) || 371));
  const height = Math.max(1, Math.round(Number(canvasHeight) || 433));
  const minimumVisibleWidth = Math.min(40, width);
  const minimumVisibleHeight = Math.min(24, height);
  const edge = (candidate, maximum) => clamp(Math.round(Number(candidate) || 0), 0, maximum);
  const left = edge(value?.left, width - minimumVisibleWidth);
  const right = edge(value?.right, width - minimumVisibleWidth - left);
  const top = edge(value?.top, height - minimumVisibleHeight);
  const bottom = edge(value?.bottom, height - minimumVisibleHeight - top);
  return { top, right, bottom, left };
}

function visibleCanvas(layout) {
  const canvasWidth = Number(layout?.canvasWidth) || 371;
  const canvasHeight = Number(layout?.canvasHeight) || 433;
  const crop = normalizeCrop(layout?.crop, canvasWidth, canvasHeight);
  return {
    width: Math.max(40, canvasWidth - crop.left - crop.right),
    height: Math.max(24, canvasHeight - crop.top - crop.bottom),
    crop,
  };
}

function resizedPreview(activeGesture, screenX, screenY) {
  const deltaX = screenX - activeGesture.startScreenX;
  const deltaY = screenY - activeGesture.startScreenY;
  const current = activeGesture.startBounds;
  const canvas = visibleCanvas(activeGesture.startLayout);
  const ratio = Math.max(0.1, canvas.width / canvas.height);
  const handle = activeGesture.handle;
  const horizontalWidth = handle.includes('e')
    ? current.width + deltaX
    : (handle.includes('w') ? current.width - deltaX : current.width);
  const verticalHeight = handle.includes('s')
    ? current.height + deltaY
    : (handle.includes('n') ? current.height - deltaY : current.height);
  const verticalWidth = verticalHeight * ratio;
  let requestedWidth = horizontalWidth;
  if (!handle.includes('e') && !handle.includes('w')) requestedWidth = verticalWidth;
  else if ((handle.includes('n') || handle.includes('s'))
    && Math.abs(verticalWidth - current.width) > Math.abs(horizontalWidth - current.width)) {
    requestedWidth = verticalWidth;
  }
  let width = clamp(Math.round(requestedWidth), 120, 4000);
  let height = clamp(Math.round(width / ratio), 70, 3000);
  width = Math.round(height * ratio);
  let x = current.x;
  let y = current.y;
  if (handle.includes('w')) x = current.x + current.width - width;
  else if (!handle.includes('e')) x = Math.round(current.x + (current.width - width) / 2);
  if (handle.includes('n')) y = current.y + current.height - height;
  else if (!handle.includes('s')) y = Math.round(current.y + (current.height - height) / 2);
  return {
    bounds: { x: Math.round(x), y: Math.round(y), width, height },
    scale: Math.min(width / canvas.width, height / canvas.height),
    crop: canvas.crop,
  };
}

function croppedPreview(activeGesture, screenX, screenY) {
  const deltaX = screenX - activeGesture.startScreenX;
  const deltaY = screenY - activeGesture.startScreenY;
  const layout = activeGesture.startLayout;
  const scale = Math.max(0.1, Number(layout.scale) || 1);
  const handle = activeGesture.handle;
  const startingCrop = normalizeCrop(layout.crop, layout.canvasWidth, layout.canvasHeight);
  const requestedCrop = { ...startingCrop };
  if (handle.includes('w')) requestedCrop.left = startingCrop.left + (deltaX / scale);
  if (handle.includes('e')) requestedCrop.right = startingCrop.right - (deltaX / scale);
  if (handle.includes('n')) requestedCrop.top = startingCrop.top + (deltaY / scale);
  if (handle.includes('s')) requestedCrop.bottom = startingCrop.bottom - (deltaY / scale);
  const crop = normalizeCrop(requestedCrop, layout.canvasWidth, layout.canvasHeight);
  const canvas = visibleCanvas({ ...layout, crop });
  const width = Math.max(40, Math.round(canvas.width * scale));
  const height = Math.max(24, Math.round(canvas.height * scale));
  const current = activeGesture.startBounds;
  return {
    bounds: {
      x: handle.includes('w') ? current.x + current.width - width : current.x,
      y: handle.includes('n') ? current.y + current.height - height : current.y,
      width,
      height,
    },
    scale,
    crop,
  };
}

function renderOutput() {
  if (!appState?.editorBounds || !appState?.outputBounds) return;
  const rectangle = appState.outputBounds;
  outputBox.style.left = `${rectangle.x - appState.editorBounds.x}px`;
  outputBox.style.top = `${rectangle.y - appState.editorBounds.y}px`;
  outputBox.style.width = `${rectangle.width}px`;
  outputBox.style.height = `${rectangle.height}px`;
  const crop = Boolean(appState.cropMode);
  editor.classList.toggle('crop-active', crop);
  const cropButton = document.getElementById('crop-toggle');
  cropButton.textContent = `Crop edges: ${crop ? 'ON' : 'OFF'}`;
  cropButton.setAttribute('aria-pressed', String(crop));
}

function renderDirectLogoEditors() {
  for (const side of ['away', 'home']) {
    const element = document.getElementById(`${side}-logo-direct-editor`);
    const image = document.getElementById(`${side}-logo-direct-image`);
    const choice = activeLogoChoice(side);
    const geometry = appState?.logoGeometry?.[side];
    const usable = activeView === 'teams'
      && logoChoiceState(side).teamId
      && geometry
      && Number(geometry.width) > 0
      && Number(geometry.height) > 0
      && appState?.outputBounds
      && appState?.editorBounds;
    element.classList.toggle('hidden', !usable);
    if (choice?.logo) image.setAttribute('src', choice.logo);
    else image.removeAttribute('src');
    if (!usable || (logoDirectGesture && logoDirectGesture.side === side)) continue;
    element.style.left = `${appState.outputBounds.x - appState.editorBounds.x + Number(geometry.x)}px`;
    element.style.top = `${appState.outputBounds.y - appState.editorBounds.y + Number(geometry.y)}px`;
    element.style.width = `${Math.max(18, Number(geometry.width))}px`;
    element.style.height = `${Math.max(18, Number(geometry.height))}px`;
    image.style.transform = `rotate(${Number(logoChoiceState(side).transform?.rotation) || 0}deg)`;
  }
}

function renderChrome() {
  const detected = Boolean(appState?.gameDetected);
  document.getElementById('game-status').textContent = detected
    ? (activeView === 'teams'
      ? `${appState.gameTitle || 'College Football 27'} and automatic OCR stay active`
      : `${appState.gameTitle || 'College Football 27'} stays active while resizing`)
    : 'Primary display fallback - no game focus is taken';
  document.getElementById('no-game').classList.toggle('hidden', detected);
}

function render() {
  renderChrome();
  renderOutput();
  renderTeamControls();
  renderDirectLogoEditors();
}

function beginDirectLogoEdit(event) {
  const element = event.currentTarget;
  const side = element.dataset.side;
  const state = logoChoiceState(side);
  if (activeView !== 'teams' || !state.teamId || logoDirectGesture) return;
  event.preventDefault();
  event.stopPropagation();
  const bounds = element.getBoundingClientRect();
  const action = event.target.closest('[data-logo-action]')?.dataset.logoAction || 'move';
  const centerX = bounds.left + (bounds.width / 2);
  const centerY = bounds.top + (bounds.height / 2);
  logoSliderActive.add(side);
  logoDirectGesture = {
    side,
    action,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    centerX,
    centerY,
    startDistance: Math.max(1, Math.hypot(event.clientX - centerX, event.clientY - centerY)),
    startAngle: Math.atan2(event.clientY - centerY, event.clientX - centerX),
    startElementBounds: {
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
    },
    outerScale: Math.max(0.1, Number(appState?.layout?.scale) || 1),
    startTransform: readLogoTransform(side),
  };
  element.classList.add('is-dragging');
  element.setPointerCapture?.(event.pointerId);
}

function paintDirectLogoGesture(gesture, transform) {
  const element = document.getElementById(`${gesture.side}-logo-direct-editor`);
  const image = document.getElementById(`${gesture.side}-logo-direct-image`);
  const start = gesture.startElementBounds;
  const scaleRatio = Math.max(0.05, Number(transform.scale) || 1)
    / Math.max(0.05, Number(gesture.startTransform.scale) || 1);
  const width = Math.max(18, start.width * scaleRatio);
  const height = Math.max(18, start.height * scaleRatio);
  const startCenterX = start.left + (start.width / 2);
  const startCenterY = start.top + (start.height / 2);
  const centerX = startCenterX + ((Number(transform.x) - Number(gesture.startTransform.x)) * gesture.outerScale);
  const centerY = startCenterY + ((Number(transform.y) - Number(gesture.startTransform.y)) * gesture.outerScale);
  element.style.left = `${centerX - (width / 2)}px`;
  element.style.top = `${centerY - (height / 2)}px`;
  element.style.width = `${width}px`;
  element.style.height = `${height}px`;
  image.style.transform = `rotate(${Number(transform.rotation) || 0}deg)`;
}

function moveDirectLogoEdit(event) {
  if (!logoDirectGesture || event.pointerId !== logoDirectGesture.pointerId) return;
  event.preventDefault();
  const gesture = logoDirectGesture;
  const side = gesture.side;
  const transform = { ...gesture.startTransform };
  if (gesture.action === 'move') {
    const outerScale = Math.max(0.1, Number(appState?.layout?.scale) || 1);
    transform.x += (event.clientX - gesture.startX) / outerScale;
    transform.y += (event.clientY - gesture.startY) / outerScale;
  } else if (gesture.action === 'resize') {
    const distance = Math.max(1, Math.hypot(event.clientX - gesture.centerX, event.clientY - gesture.centerY));
    transform.scale *= distance / gesture.startDistance;
  } else if (gesture.action === 'rotate') {
    const angle = Math.atan2(event.clientY - gesture.centerY, event.clientX - gesture.centerX);
    let delta = (angle - gesture.startAngle) * (180 / Math.PI);
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
    transform.rotation += delta;
  }
  const xInput = document.getElementById(`${side}-logo-x`);
  const yInput = document.getElementById(`${side}-logo-y`);
  const scaleInput = document.getElementById(`${side}-logo-scale`);
  const rotationInput = document.getElementById(`${side}-logo-rotation`);
  xInput.value = String(clamp(Math.round(transform.x), Number(xInput.min), Number(xInput.max)));
  yInput.value = String(clamp(Math.round(transform.y), Number(yInput.min), Number(yInput.max)));
  scaleInput.value = String(clamp(Math.round(transform.scale * 100), Number(scaleInput.min), Number(scaleInput.max)));
  rotationInput.value = String(clamp(Math.round(transform.rotation), Number(rotationInput.min), Number(rotationInput.max)));
  paintDirectLogoGesture(gesture, transform);
  scheduleLogoPreview(side);
}

function finishDirectLogoEdit(event) {
  if (!logoDirectGesture || event.pointerId !== logoDirectGesture.pointerId) return;
  event.preventDefault();
  const finished = logoDirectGesture;
  logoDirectGesture = null;
  const element = document.getElementById(`${finished.side}-logo-direct-editor`);
  element.classList.remove('is-dragging');
  element.releasePointerCapture?.(finished.pointerId);
  saveLogoTransform(finished.side);
}

function acceptState(next) {
  if (!next || typeof next !== 'object') return;
  if (gesture) {
    queuedState = next;
    return;
  }
  appState = next;
  render();
}

function beginGesture(event) {
  if (activeView !== 'resize' || !appState?.outputBounds || gesture) return;
  event.preventDefault();
  event.stopPropagation();
  const handle = event.target.closest('.resize-handle')?.dataset.handle || '';
  const type = handle ? 'resize' : 'move';
  gesture = {
    type,
    handle,
    operation: appState.cropMode ? 'crop' : 'resize',
    pointerId: event.pointerId,
    startScreenX: event.screenX,
    startScreenY: event.screenY,
    startBounds: clone(appState.outputBounds),
    startLayout: clone(appState.layout),
  };
  queuedState = null;
  editor.classList.add('is-dragging');
  outputBox.setPointerCapture?.(event.pointerId);
  const payload = { phase: 'start', screenX: event.screenX, screenY: event.screenY };
  if (type === 'resize') {
    enqueueOverlayCommand('resize', { ...payload, handle, operation: gesture.operation }).catch(reportError);
  } else {
    enqueueOverlayCommand('move', payload).catch(reportError);
  }
}

function previewPointer(pointer, send = true) {
  if (!gesture) return;
  let result;
  if (gesture.type === 'move') {
    result = {
      bounds: {
        ...gesture.startBounds,
        x: Math.round(gesture.startBounds.x + pointer.screenX - gesture.startScreenX),
        y: Math.round(gesture.startBounds.y + pointer.screenY - gesture.startScreenY),
      },
      scale: gesture.startLayout.scale,
      crop: gesture.startLayout.crop,
    };
  } else {
    result = gesture.operation === 'crop'
      ? croppedPreview(gesture, pointer.screenX, pointer.screenY)
      : resizedPreview(gesture, pointer.screenX, pointer.screenY);
  }
  appState.outputBounds = result.bounds;
  appState.layout = {
    ...appState.layout,
    width: result.bounds.width,
    height: result.bounds.height,
    scale: result.scale,
    crop: result.crop,
  };
  renderOutput();
  if (!send) return;
  const payload = {
    phase: 'move',
    screenX: pointer.screenX,
    screenY: pointer.screenY,
  };
  if (gesture.type === 'resize') {
    enqueueOverlayCommand('resize', {
      ...payload,
      operation: gesture.operation,
      handle: gesture.handle,
    }).catch(reportError);
  } else {
    enqueueOverlayCommand('move', payload).catch(reportError);
  }
}

function flushPointerMove() {
  pointerFrame = null;
  if (!gesture || !pendingPointer) return;
  const pointer = pendingPointer;
  pendingPointer = null;
  previewPointer(pointer);
}

function onPointerMove(event) {
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  event.preventDefault();
  pendingPointer = { screenX: event.screenX, screenY: event.screenY };
  if (pointerFrame === null) pointerFrame = requestAnimationFrame(flushPointerMove);
}

async function finishGesture(event) {
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  event.preventDefault();
  if (pointerFrame !== null) cancelAnimationFrame(pointerFrame);
  pointerFrame = null;
  pendingPointer = null;
  const finished = gesture;
  const pointer = { screenX: event.screenX, screenY: event.screenY };
  previewPointer(pointer, false);
  gesture = null;
  editor.classList.remove('is-dragging');
  outputBox.releasePointerCapture?.(finished.pointerId);
  const payload = { phase: 'end', screenX: pointer.screenX, screenY: pointer.screenY };
  try {
    if (finished.type === 'resize') {
      await enqueueOverlayCommand('resize', {
        ...payload,
        operation: finished.operation,
        handle: finished.handle,
      });
    } else {
      await enqueueOverlayCommand('move', payload);
    }
    queuedState = null;
    acceptState(await api.getInGameEditorState());
  } catch (error) {
    reportError(error);
    if (queuedState) acceptState(queuedState);
  }
}

outputBox.addEventListener('pointerdown', beginGesture);
window.addEventListener('pointermove', onPointerMove, { passive: false });
window.addEventListener('pointerup', finishGesture, { passive: false });
window.addEventListener('pointercancel', finishGesture, { passive: false });

document.getElementById('crop-toggle').addEventListener('click', () => {
  api.setCropMode(!appState?.cropMode)
    .then(() => api.getInGameEditorState()).then(acceptState, reportError);
});
document.getElementById('reset-crop').addEventListener('click', () => {
  api.resetThemeCrop().then(() => api.getInGameEditorState()).then(acceptState, reportError);
});
document.getElementById('view-resize').addEventListener('click', () => setView('resize'));
document.getElementById('view-teams').addEventListener('click', () => setView('teams'));

for (const side of ['away', 'home']) {
  document.getElementById(`${side}-team`).addEventListener('click', () => openTeamPicker(side));
  document.getElementById(`${side}-rank`).addEventListener('click', () => openRankPicker(side));
  document.getElementById(`${side}-logo`).addEventListener('click', () => openLogoPicker(side));
  document.getElementById(`${side}-import-logo`).addEventListener('click', () => importLogo(side));
  const deleteButton = document.getElementById(`${side}-delete-logo`);
  deleteButton.addEventListener('click', () => deleteImportedLogo(side, deleteButton));
  document.getElementById(`${side}-restore-logo-defaults`).addEventListener('click', () => restoreLogoDefaults(side));
  document.getElementById(`${side}-capture-logo`).addEventListener('click', () => captureLogoPlacement(side));
  const logoPreview = document.getElementById(`${side}-logo-preview`);
  logoPreview.addEventListener('pointerdown', beginLogoPreviewDrag);
  logoPreview.addEventListener('pointermove', moveLogoPreview, { passive: false });
  logoPreview.addEventListener('pointerup', finishLogoPreviewDrag, { passive: false });
  logoPreview.addEventListener('pointercancel', finishLogoPreviewDrag, { passive: false });
  logoPreview.addEventListener('dragstart', (event) => event.preventDefault());
  const directEditor = document.getElementById(`${side}-logo-direct-editor`);
  directEditor.addEventListener('pointerdown', beginDirectLogoEdit);
  directEditor.addEventListener('pointermove', moveDirectLogoEdit, { passive: false });
  directEditor.addEventListener('pointerup', finishDirectLogoEdit, { passive: false });
  directEditor.addEventListener('pointercancel', finishDirectLogoEdit, { passive: false });
  document.querySelectorAll(`.logo-transform[data-side="${side}"] input[data-logo-control]`).forEach((input) => {
    input.addEventListener('pointerdown', () => logoSliderActive.add(side));
    input.addEventListener('input', () => {
      document.getElementById(`${side}-logo-${input.dataset.logoControl}-number`).value = input.value;
      scheduleLogoPreview(side);
    });
    input.addEventListener('change', () => saveLogoTransform(side));
    input.addEventListener('pointercancel', () => saveLogoTransform(side));
  });
  document.querySelectorAll(`.logo-transform[data-side="${side}"] input[data-logo-number]`).forEach((input) => {
    const field = input.dataset.logoNumber;
    input.addEventListener('pointerdown', () => logoSliderActive.add(side));
    input.addEventListener('input', () => {
      if (input.value === '' || input.value === '-') return;
      setLogoControlValue(side, field, input.value);
      scheduleLogoPreview(side);
    });
    input.addEventListener('change', () => {
      setLogoControlValue(side, field, input.value);
      saveLogoTransform(side);
    });
    input.addEventListener('click', () => openLogoNumberPad(side, field));
  });
  document.getElementById(`${side}-reset-logo-transform`).addEventListener('click', async () => {
    const state = logoChoiceState(side);
    if (!state.teamId) return;
    try {
      acceptState(await api.saveTeamLogoTransform({
        side,
        teamId: state.teamId,
        variantId: state.activeVariantId || 'default',
        reset: true,
      }));
      setToast(`${state.teamName} logo placement reset.`);
    } catch (error) {
      reportError(error);
    }
  });
}
document.getElementById('close-choice-picker').addEventListener('click', closeChoicePicker);
document.getElementById('close-logo-number-pad').addEventListener('click', closeLogoNumberPad);
document.getElementById('clear-logo-number').addEventListener('click', () => {
  logoNumberPadValue = '';
  renderLogoNumberPad();
});
document.getElementById('apply-logo-number').addEventListener('click', applyLogoNumberPad);
document.querySelectorAll('[data-logo-digit]').forEach((button) => {
  button.addEventListener('click', () => appendLogoNumberDigit(button.dataset.logoDigit));
});
document.querySelector('[data-logo-number-action="sign"]').addEventListener('click', () => {
  if (!logoNumberPadTarget) return;
  logoNumberPadValue = logoNumberPadValue.startsWith('-')
    ? logoNumberPadValue.slice(1)
    : `-${logoNumberPadValue || '0'}`;
  renderLogoNumberPad();
});
document.querySelector('[data-logo-number-action="backspace"]').addEventListener('click', () => {
  if (!logoNumberPadTarget) return;
  logoNumberPadValue = logoNumberPadValue.slice(0, -1);
  if (logoNumberPadValue === '-') logoNumberPadValue = '';
  renderLogoNumberPad();
});
document.getElementById('clear-team-overrides').addEventListener('click', async () => {
  if (teamUpdateRunning) return;
  teamUpdateRunning = true;
  try {
    acceptState(await api.clearManualTeamOverrides());
    closeChoicePicker();
    setToast('Both teams and ranks returned to automatic OCR.');
  } catch (error) {
    reportError(error);
  } finally {
    teamUpdateRunning = false;
  }
});
document.getElementById('save-close').addEventListener('click', () => {
  api.closeQuickSettings().catch(reportError);
});
document.getElementById('center-horizontal').addEventListener('click', async () => {
  try {
    await api.centerOverlay({ horizontal: true });
    setToast('Scorebug centered left-to-right.');
  } catch (error) { reportError(error); }
});
document.getElementById('center-vertical').addEventListener('click', async () => {
  try {
    await api.centerOverlay({ vertical: true });
    setToast('Scorebug centered top-to-bottom.');
  } catch (error) { reportError(error); }
});
wireScorebugColorControls();
wireRecordControls();

api.onInGameEditorState(acceptState);
api.onTeamLogoGeometry((update) => {
  if (!appState || !['away', 'home'].includes(update?.side)) return;
  appState.logoGeometry ||= { away: null, home: null };
  appState.logoGeometry[update.side] = update.bounds || null;
  paintLogoGeometry(update.side);
  renderDirectLogoEditors();
  if (activeView === 'teams' && update.bounds && !activeLogoCapture(update.side) && !logoCaptureRunning.has(update.side)) {
    setTimeout(() => captureLogoPlacement(update.side, { quiet: true }), 120);
  }
});
window.addEventListener('resize', () => {
  for (const side of ['away', 'home']) paintLogoPreview(side, readLogoTransform(side));
});
api.inGameEditorReady().then(acceptState, reportError);
