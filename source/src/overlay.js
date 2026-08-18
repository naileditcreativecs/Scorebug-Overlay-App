'use strict';

const overlay = document.getElementById('overlay');
const themeView = document.getElementById('theme-view');
const statusOutput = document.getElementById('status');
const chromaKeyApi = window.CFB27ChromaKey;

const THEME_TRANSPARENCY_CSS = `
  html, body {
    background: transparent !important;
    overflow: hidden !important;
    scrollbar-width: none !important;
  }
  body::-webkit-scrollbar { display: none !important; }
  #__bundler_loading,
  #__bundler_thumbnail,
  #__bundler_err {
    display: none !important;
  }
`;

let currentStatus = null;
let currentState = null;
let loadedThemeUrl = null;
let themeReady = false;
let themeLoadToken = 0;
let themePreparationToken = 0;
let currentLayout = { canvasWidth: 371, canvasHeight: 433, scale: 1 };
let currentChromaKey = chromaKeyApi.normalizeGreenScreen();
let resizeGesture = null;
let resizeAnimationFrame = null;
let pendingResizePointer = null;
let logoGeometryFrame = null;

function setStatus(message) {
  statusOutput.textContent = String(message || 'Ready');
}

function applyChromaKey(value) {
  currentChromaKey = chromaKeyApi.normalizeGreenScreen(value);
  overlay.classList.toggle('chroma-key-enabled', currentChromaKey.enabled);
  overlay.dataset.chromaKeyColor = currentChromaKey.color;
  overlay.dataset.chromaKeyTolerance = String(currentChromaKey.tolerance);
  overlay.dataset.chromaKeySoftness = String(currentChromaKey.softness);
  document.body.classList.toggle('chroma-backdrop-solid', currentChromaKey.backdrop === 'green');
  document.body.style.setProperty('--chroma-backdrop-color', currentChromaKey.color);
  pushChromaKeyToTheme();
}

// The key filter runs INSIDE the theme document. Filtering the <webview>
// element from out here composited as a solid black box on machines where
// Chromium cannot run SVG filters over the guest's out-of-process surface.
let guestChromaSignature = '';
function pushChromaKeyToTheme(force) {
  if (!themeReady) return;
  const source = chromaKeyApi.guestFilterScript(currentChromaKey);
  if (!force && source === guestChromaSignature) return;
  themeView.executeJavaScript(source)
    .then(() => { guestChromaSignature = source; })
    .catch(() => { guestChromaSignature = ''; });
}

function applyQuickSettings(open) {
  overlay.classList.toggle('quick-settings-open', Boolean(open) && !currentStatus?.fullWindowEditor);
  const greenButton = document.getElementById('quick-green-screen');
  greenButton.setAttribute('aria-pressed', String(currentChromaKey.enabled));
  greenButton.textContent = `Green screen: ${currentChromaKey.enabled ? 'ON' : 'OFF'}`;
}

function resizeOperation() {
  return currentStatus?.cropMode ? 'crop' : 'resize';
}

function sendResizePhase(phase, pointer) {
  if (!resizeGesture || !pointer) return;
  const { operation, handle } = resizeGesture;
  window.overlayControl.resizeOverlay({
    phase,
    operation,
    handle,
    screenX: pointer.x,
    screenY: pointer.y,
  }).catch((error) => setStatus(`${operation === 'crop' ? 'Crop' : 'Resize'} failed: ${error.message}`));
}

function flushResizeFrame() {
  resizeAnimationFrame = null;
  if (!resizeGesture || !pendingResizePointer) return;
  const pointer = pendingResizePointer;
  pendingResizePointer = null;
  sendResizePhase('move', pointer);
}

function startResize(event) {
  event.preventDefault();
  event.stopPropagation();
  resizeGesture = {
    handle: event.currentTarget.dataset.resizeHandle,
    operation: resizeOperation(),
    lastPointer: { x: event.screenX, y: event.screenY },
  };
  pendingResizePointer = null;
  sendResizePhase('start', resizeGesture.lastPointer);
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function continueResize(event) {
  if (!resizeGesture) return;
  event.preventDefault();
  resizeGesture.lastPointer = { x: event.screenX, y: event.screenY };
  pendingResizePointer = resizeGesture.lastPointer;
  if (resizeAnimationFrame === null) {
    resizeAnimationFrame = requestAnimationFrame(flushResizeFrame);
  }
}

function finishResize(event) {
  if (!resizeGesture) return;
  const finalPointer = Number.isFinite(Number(event?.screenX))
    ? { x: event.screenX, y: event.screenY }
    : (pendingResizePointer || resizeGesture.lastPointer);
  if (resizeAnimationFrame !== null) cancelAnimationFrame(resizeAnimationFrame);
  resizeAnimationFrame = null;
  pendingResizePointer = null;
  sendResizePhase('end', finalPointer);
  resizeGesture = null;
}

function readPath(object, dottedPath) {
  return dottedPath.split('.').reduce((value, part) => value?.[part], object);
}

function updateMock(state) {
  if (!state) return;
  document.querySelectorAll('[data-mock]').forEach((element) => {
    const value = readPath(state, element.dataset.mock);
    if (value !== undefined && value !== null) element.textContent = String(value);
  });

  for (const team of ['away', 'home']) {
    const timeoutCount = Math.max(0, Math.min(3, Number(state[team]?.timeouts) || 0));
    const timeoutRoot = document.querySelector(`[data-mock-timeouts="${team}"]`);
    const timeoutIndicators = [...(timeoutRoot?.querySelectorAll('i') || [])];
    const firstRemaining = timeoutIndicators.length - timeoutCount;
    timeoutIndicators.forEach((indicator, index) => {
      indicator.classList.toggle('is-used', index < firstRemaining);
    });
    document
      .querySelector(`[data-mock-possession="${team}"]`)
      ?.classList.toggle('is-active', Boolean(state[team]?.possession));
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function themeNormalizationSource(layout) {
  const target = {
    width: Math.max(1, Number(layout?.canvasWidth) || 371),
    height: Math.max(1, Number(layout?.canvasHeight) || 433),
    authoredCanvas: layout?.authoredCanvas === true,
  };
  const serializedTarget = JSON.stringify(JSON.stringify(target));
  const computeFit = window.CFB27ThemeFit.computeFit.toString();
  const scoreThemeRootCandidate = window.CFB27ThemeFit.scoreThemeRootCandidate.toString();

  return `(() => {
    const target = JSON.parse(${serializedTarget});
    const computeFit = ${computeFit};
    const scoreThemeRootCandidate = ${scoreThemeRootCandidate};
    const declaredNumber = (name) => {
      const value = Number(document.querySelector('meta[name="' + name + '"]')?.content);
      return Number.isFinite(value) && value > 0 ? value : null;
    };
    const authoredCanvas = {
      width: declaredNumber('cfb27-canvas-width')
        || declaredNumber('canvas-width')
        || declaredNumber('overlay-width'),
      height: declaredNumber('cfb27-canvas-height')
        || declaredNumber('canvas-height')
        || declaredNumber('overlay-height'),
    };
    const declaredRoot = document.querySelector(
      '[data-cfb27-scorebug], [data-cfb27-overlay-root], [data-scorebug]'
    );
    const authoredRoot = declaredRoot || (target.authoredCanvas ? null : document.querySelector('#dc-root'));
    const authoredRootBox = authoredRoot?.getBoundingClientRect?.();
    const metadataMatchesTarget = authoredCanvas.width && authoredCanvas.height
      && Math.abs(authoredCanvas.width - target.width) <= 1
      && Math.abs(authoredCanvas.height - target.height) <= 1;
    const usesAuthoredCanvas = target.authoredCanvas || metadataMatchesTarget;

    // A standalone theme that declares its canvas is already laid out against
    // that viewport. Preserve its authored offsets and responsive layout. The
    // legacy root fitter is only for files that do not declare a canvas; using
    // it here would fit the editor's tall preview root into a wide scorebug and
    // make the actual graphic look tiny, clipped, or missing.
    if (usesAuthoredCanvas) {
      if (!authoredRootBox || authoredRootBox.width <= 1 || authoredRootBox.height <= 1) {
        return { ready: false };
      }
      document.documentElement.style.setProperty('width', target.width + 'px', 'important');
      document.documentElement.style.setProperty('height', target.height + 'px', 'important');
      document.documentElement.style.setProperty('overflow', 'hidden', 'important');
      document.body.style.setProperty('width', target.width + 'px', 'important');
      document.body.style.setProperty('height', target.height + 'px', 'important');
      document.body.style.setProperty('min-height', '0', 'important');
      document.body.style.setProperty('margin', '0', 'important');
      document.body.style.setProperty('padding', '0', 'important');
      document.body.style.setProperty('overflow', 'hidden', 'important');
      window.__CFB27_THEME_ROOT__ = authoredRoot;
      return {
        ready: true,
        strategy: ['authoredCanvas'],
        source: {
          width: authoredCanvas.width || target.width,
          height: authoredCanvas.height || target.height,
        },
        fitted: { x: 0, y: 0, width: target.width, height: target.height },
        scale: 1,
      };
    }
    const composedParent = (element) => {
      if (!(element instanceof Element)) return null;
      if (element.parentElement) return element.parentElement;
      const rootNode = element.getRootNode?.();
      return rootNode?.host instanceof Element ? rootNode.host : null;
    };
    const allElements = [];
    const collectElements = (container) => {
      for (const element of Array.from(container?.children || [])) {
        allElements.push(element);
        collectElements(element);
        if (element.shadowRoot) collectElements(element.shadowRoot);
      }
    };
    collectElements(document.body);
    const boxCache = new WeakMap();
    const styleCache = new WeakMap();
    const visibilityCache = new WeakMap();
    const boxOf = (element) => {
      if (!boxCache.has(element)) boxCache.set(element, element.getBoundingClientRect());
      return boxCache.get(element);
    };
    const styleOf = (element) => {
      if (!styleCache.has(element)) styleCache.set(element, getComputedStyle(element));
      return styleCache.get(element);
    };
    const visible = (element) => {
      if (!(element instanceof Element)) return false;
      if (visibilityCache.has(element)) return visibilityCache.get(element);
      const box = boxOf(element);
      if (box.width <= 1 || box.height <= 1) {
        visibilityCache.set(element, false);
        return false;
      }
      let branch = element;
      while (branch instanceof Element) {
        const style = styleOf(branch);
        const opacity = Number.parseFloat(style.opacity);
        if (style.display === 'none' || style.visibility === 'hidden'
          || style.visibility === 'collapse' || style.contentVisibility === 'hidden'
          || (Number.isFinite(opacity) && opacity <= 0.01)) {
          visibilityCache.set(element, false);
          return false;
        }
        branch = composedParent(branch);
      }
      visibilityCache.set(element, true);
      return true;
    };
    const visibleChildren = (element) => Array.from(element?.children || []).filter(visible);
    const strongRootSelector = [
      '[data-cfb27-scorebug]', '[data-cfb27-overlay-root]', '[data-scorebug]'
    ].join(',');
    const semanticRootSelector = [
      '#scorebug', '#scoreboard', '#dc-root', '.scorebug', '.scoreboard', '.score-bug',
      '[id*="scorebug" i]', '[class*="scorebug" i]'
    ].join(',');
    const excludedTags = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE', 'NOSCRIPT', 'HEAD']);
    const identityOf = (element) => [
      element.id || '',
      element.getAttribute?.('class') || '',
      element.getAttribute?.('role') || '',
    ].join(' ');
    const uiLike = (element) => /(?:^|[-_\\s])(control|controls|editor|settings|toolbar|reference|preview)(?:$|[-_\\s])/i
      .test(identityOf(element));
    const excluded = (element) => excludedTags.has(element.tagName)
      || String(element.id || '').startsWith('__bundler_');
    const transparentColor = (value) => {
      const normalized = String(value || '').replace(/\\s+/g, '').toLowerCase();
      return !normalized || normalized === 'transparent' || normalized === 'rgba(0,0,0,0)';
    };
    const painted = (element) => {
      const style = styleOf(element);
      const borderWidth = ['Top', 'Right', 'Bottom', 'Left']
        .reduce((sum, side) => sum + (Number.parseFloat(style['border' + side + 'Width']) || 0), 0);
      return style.backgroundImage !== 'none'
        || !transparentColor(style.backgroundColor)
        || borderWidth > 0
        || (style.boxShadow && style.boxShadow !== 'none')
        || (style.filter && style.filter !== 'none');
    };
    const visibleElements = allElements.filter((element) => !excluded(element) && visible(element));
    const explicitContainers = allElements.filter((element) => element.matches?.(strongRootSelector)
      && element.dataset?.cfb27OverlayManagedRoot !== 'true');
    const bindingElements = visibleElements.filter((element) => element.matches?.(
      '[data-cfb27-bind], [data-cfb27-import-dynamic]'
    ));
    let bindingRoot = bindingElements.length >= 3 ? bindingElements[0] : null;
    while (bindingRoot && bindingRoot !== document.body
      && !bindingElements.every((element) => bindingRoot === element || bindingRoot.contains(element))) {
      bindingRoot = composedParent(bindingRoot);
    }
    if (bindingRoot === document.body || bindingRoot === document.documentElement) bindingRoot = null;
    const legacyStructure = (element) => {
      const box = boxOf(element);
      const direct = visibleChildren(element);
      if (box.width < 180 || box.width > 1600 || box.height < 160 || box.height > 1200) return false;
      if (direct.length < 4 || direct.length > 8) return false;
      const heights = direct.slice(0, 4).map((child) => boxOf(child).height);
      return heights.length === 4
        && Math.abs(heights[0] - heights[1]) < Math.max(14, heights[0] * 0.18)
        && heights[0] > heights[2] * 1.35
        && heights[0] > heights[3] * 1.35;
    };
    const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
    const rememberedRoot = window.__CFB27_THEME_ROOT__;
    const candidates = visibleElements.map((element, index) => {
      const box = boxOf(element);
      const direct = visibleChildren(element);
      const textLength = String(element.textContent || '').replace(/\\s+/g, ' ').trim().length;
      const media = element.matches?.('canvas, svg, img, picture, video') === true;
      const customElement = element.tagName.includes('-');
      const hostManaged = element.dataset?.cfb27OverlayManagedRoot === 'true';
      const isExplicit = element.matches?.(strongRootSelector) === true && !hostManaged;
      const runtimeRoot = element.id === 'dc-root'
        && (typeof window.__dcSetProps === 'function' || window.__dcRootName != null);
      const isUiLike = uiLike(element);
      const semantic = !isUiLike && element.matches?.(semanticRootSelector) === true;
      const hasBindings = element.matches?.('[data-cfb27-bind], [data-cfb27-import-dynamic]') === true
        || element.querySelector?.('[data-cfb27-bind], [data-cfb27-import-dynamic]') !== null;
      const hasCompactVisualChild = direct.some((child) => {
        const childBox = boxOf(child);
        const ratio = (childBox.width * childBox.height) / Math.max(1, box.width * box.height);
        return ratio >= 0.008 && ratio <= 0.72
          && (painted(child) || child.matches?.('canvas, svg, img, picture, video')
            || String(child.textContent || '').trim().length > 0 || visibleChildren(child).length > 0);
      });
      const leafTexts = new Set();
      for (const descendant of [element, ...Array.from(element.querySelectorAll?.('*') || [])]) {
        if (!visible(descendant)) continue;
        const ownText = Array.from(descendant.childNodes || [])
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => String(node.textContent || '').replace(/\\s+/g, ' ').trim())
          .filter(Boolean)
          .join(' ');
        if (ownText) leafTexts.add(ownText);
      }
      const descriptor = {
        index,
        width: box.width,
        height: box.height,
        visible: true,
        excluded: false,
        remembered: element === rememberedRoot && element.isConnected,
        explicit: isExplicit,
        runtimeRoot,
        insideExplicit: !isExplicit && explicitContainers.some((container) => container.contains?.(element)),
        bindingRoot: element === bindingRoot,
        semantic,
        legacyStructure: legacyStructure(element),
        media,
        customElement,
        bodyChild: composedParent(element) === document.body,
        painted: painted(element),
        hasBindings,
        directVisibleChildren: direct.length,
        visibleDescendants: Math.min(200, element.querySelectorAll?.('*').length || 0),
        textLength,
        leafTextCount: leafTexts.size,
        viewportCoverage: (box.width * box.height) / viewportArea,
        hasCompactVisualChild,
        uiLike: isUiLike,
      };
      const visualSignal = descriptor.remembered || descriptor.explicit || descriptor.runtimeRoot || descriptor.insideExplicit
        || descriptor.bindingRoot || descriptor.semantic || descriptor.legacyStructure
        || descriptor.media || descriptor.customElement || descriptor.painted
        || descriptor.hasBindings || descriptor.directVisibleChildren > 0 || descriptor.textLength > 0;
      const trustedRoot = descriptor.explicit || descriptor.runtimeRoot || descriptor.insideExplicit || descriptor.bindingRoot
        || descriptor.semantic || descriptor.legacyStructure || descriptor.media;
      const nontrivialGuess = descriptor.viewportCoverage >= 0.05 || descriptor.leafTextCount >= 4;
      return visualSignal && (trustedRoot || nontrivialGuess)
        ? { element, descriptor, score: scoreThemeRootCandidate(descriptor) }
        : null;
    }).filter(Boolean).sort((left, right) => right.score - left.score || left.descriptor.index - right.descriptor.index);
    const selected = candidates.find((candidate) => Number.isFinite(candidate.score));
    const root = selected?.element || null;
    if (!root) return { ready: false };

    // Authoring exports often center/scale the actual scorebug with transform.
    // Neutralize that placement before measuring, then apply one host-owned fit.
    // The state bridge uses the same invariant, so it cannot make a fitted root
    // disappear or expand after the first live state update.
    root.style.removeProperty('scale');
    root.style.setProperty('transform', 'none', 'important');
    root.style.setProperty('translate', 'none', 'important');
    root.style.setProperty('rotate', 'none', 'important');
    root.style.removeProperty('left');
    root.style.removeProperty('top');
    const sourceBox = root.getBoundingClientRect();
    if (!sourceBox.width || !sourceBox.height) return { ready: false };
    const fitted = computeFit({
      sourceWidth: sourceBox.width,
      sourceHeight: sourceBox.height,
      targetWidth: target.width,
      targetHeight: target.height,
    });

    // Keep the live component in its original DOM tree. Hiding only siblings
    // avoids breaking React/custom-element ownership while removing editors,
    // reference images and other authoring-page furniture.
    let branch = root;
    while (branch && branch !== document.body) {
      const parent = branch.parentElement;
      if (!parent) break;
      for (const sibling of parent.children) {
        if (sibling !== branch) sibling.style.setProperty('display', 'none', 'important');
      }
      if (parent !== document.body) {
        parent.style.setProperty('background', 'transparent', 'important');
        parent.style.setProperty('overflow', 'visible', 'important');
      }
      branch = parent;
    }

    document.documentElement.style.setProperty('width', target.width + 'px', 'important');
    document.documentElement.style.setProperty('height', target.height + 'px', 'important');
    document.documentElement.style.setProperty('background', 'transparent', 'important');
    document.documentElement.style.setProperty('overflow', 'hidden', 'important');
    document.body.style.setProperty('display', 'block', 'important');
    document.body.style.setProperty('width', target.width + 'px', 'important');
    document.body.style.setProperty('height', target.height + 'px', 'important');
    document.body.style.setProperty('min-height', '0', 'important');
    document.body.style.setProperty('margin', '0', 'important');
    document.body.style.setProperty('padding', '0', 'important');
    document.body.style.setProperty('background', 'transparent', 'important');
    document.body.style.setProperty('overflow', 'hidden', 'important');

    root.setAttribute('data-cfb27-overlay-root', '');
    root.dataset.cfb27OverlayManagedRoot = 'true';
    // Auto-sized roots whose artwork is absolutely positioned can have a
    // healthy in-flow width and then collapse to zero when made fixed. Freeze
    // the measured border box first; this also gives every imported shape a
    // stable logical canvas for subsequent state updates and refits.
    root.style.setProperty('box-sizing', 'border-box', 'important');
    root.style.setProperty('width', sourceBox.width + 'px', 'important');
    root.style.setProperty('height', sourceBox.height + 'px', 'important');
    root.style.setProperty('min-width', sourceBox.width + 'px', 'important');
    root.style.setProperty('min-height', sourceBox.height + 'px', 'important');
    root.style.setProperty('max-width', 'none', 'important');
    root.style.setProperty('max-height', 'none', 'important');
    root.style.setProperty('position', 'fixed', 'important');
    root.style.setProperty('right', 'auto', 'important');
    root.style.setProperty('bottom', 'auto', 'important');
    root.style.setProperty('margin', '0', 'important');
    root.style.setProperty('transform-origin', 'top left', 'important');
    root.style.setProperty('scale', String(fitted.scale), 'important');
    root.style.setProperty('left', '0px', 'important');
    root.style.setProperty('top', '0px', 'important');

    // Correct using the measured border box so borders and any authored root
    // transform are included. A second pass handles zoom/transform rounding.
    for (let pass = 0; pass < 2; pass += 1) {
      const placed = root.getBoundingClientRect();
      const left = parseFloat(root.style.left || '0') + fitted.offsetX - placed.left;
      const top = parseFloat(root.style.top || '0') + fitted.offsetY - placed.top;
      root.style.setProperty('left', left + 'px', 'important');
      root.style.setProperty('top', top + 'px', 'important');
    }

    const finalBox = root.getBoundingClientRect();
    const finalCoverage = (finalBox.width * finalBox.height) / Math.max(1, target.width * target.height);
    const finalReady = finalBox.width > 1 && finalBox.height > 1
      && (finalCoverage >= 0.05 || selected.descriptor.leafTextCount >= 4
        || selected.descriptor.explicit || selected.descriptor.runtimeRoot || selected.descriptor.bindingRoot
        || selected.descriptor.semantic || selected.descriptor.legacyStructure
        || selected.descriptor.media);
    if (finalReady) window.__CFB27_THEME_ROOT__ = root;
    else if (window.__CFB27_THEME_ROOT__ === root) window.__CFB27_THEME_ROOT__ = null;
    return {
      ready: finalReady,
      strategy: Object.entries(selected.descriptor)
        .filter(([key, value]) => typeof value === 'boolean' && value)
        .map(([key]) => key),
      source: { width: sourceBox.width, height: sourceBox.height },
      fitted: { x: finalBox.x, y: finalBox.y, width: finalBox.width, height: finalBox.height },
      scale: fitted.scale,
    };
  })()`;
}

async function normalizeTheme(
  layout,
  token = themeLoadToken,
  preparationToken = themePreparationToken,
) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (token !== themeLoadToken || preparationToken !== themePreparationToken) return null;
    const result = await themeView.executeJavaScript(themeNormalizationSource(layout));
    if (result?.ready) return result;
    await delay(100);
  }
  throw new Error('No standalone scorebug root was found. Add data-cfb27-scorebug to its outer element.');
}

// Keep this function self-contained: it is serialized and executed inside the
// selected HTML theme's isolated webview.
function applyTeamLogoTransformToDocument(payload = {}) {
  const side = payload.side === 'home' ? 'home' : 'away';
  const source = typeof payload.logo === 'string' ? payload.logo : '';
  const value = payload.transform && typeof payload.transform === 'object' ? payload.transform : {};
  const finite = (candidate, fallback) => Number.isFinite(Number(candidate)) ? Number(candidate) : fallback;
  const x = Math.max(-2000, Math.min(2000, finite(value.x, 0)));
  const y = Math.max(-2000, Math.min(2000, finite(value.y, 0)));
  const scale = Math.max(0.1, Math.min(5, finite(value.scale, 1.13)));
  const rotation = Math.max(-180, Math.min(180, finite(value.rotation, 0)));
  const roots = [document];
  const visited = new Set();
  const images = [];
  while (roots.length) {
    const root = roots.shift();
    if (!root || visited.has(root)) continue;
    visited.add(root);
    for (const element of Array.from(root.querySelectorAll?.('*') || [])) {
      if (element.shadowRoot) roots.push(element.shadowRoot);
      if (element.matches?.('img, image')) images.push(element);
    }
  }
  const unique = (items) => Array.from(new Set(items.filter(Boolean)));
  const explicit = [];
  for (const root of visited) {
    const binding = root.querySelector?.('[data-cfb27-import-dynamic="' + side + '.logo"], [data-cfb27-bind="' + side + '.logo"]');
    if (!binding) continue;
    explicit.push(binding.matches?.('img, image') ? binding : binding.querySelector?.('img, image'));
  }
  const live = images.filter((image) => (
    image.getAttribute?.('data-cfb27-live-logo') === side
    || image.getAttribute?.('data-cfb27-logo-side') === side
  ));
  const exact = source ? images.filter((image) => {
    const raw = image.getAttribute?.('src') || image.getAttribute?.('href') || '';
    return raw === source || image.currentSrc === source;
  }) : [];
  let candidates = unique([...live, ...explicit]);
  if (!candidates.length) candidates = unique(exact).filter((image) => {
    const box = image.getBoundingClientRect?.();
    return !box || box.width > 0 || box.height > 0;
  });
  if (!candidates.length) return { applied: false, side, count: 0 };
  const painted = candidates.filter((candidate) => {
    const box = candidate.getBoundingClientRect?.();
    const style = getComputedStyle(candidate);
    return box && box.width > 0 && box.height > 0
      && style.display !== 'none'
      && style.visibility !== 'hidden'
      && Number(style.opacity || 1) > 0.01;
  });
  if (painted.length) candidates = painted;
  const image = side === 'home' ? candidates[candidates.length - 1] : candidates[0];
  image.dataset.cfb27LogoSide = side;
  image.dataset.cfb27LogoScale = String(scale);
  image.dataset.cfb27LogoX = String(x);
  image.dataset.cfb27LogoY = String(y);
  image.dataset.cfb27LogoRotation = String(rotation);
  image.style.setProperty(
    'transform',
    'translate(' + x + 'px, ' + y + 'px) rotate(' + rotation + 'deg) scale(' + scale + ')',
    'important',
  );
  image.style.setProperty('transform-origin', 'center', 'important');
  image.style.setProperty('object-position', 'center center', 'important');
  image.style.setProperty('image-rendering', 'auto', 'important');
  // A theme transition on transform made every re-applied placement slide
  // in from the old spot; drags must track the pointer exactly.
  image.style.setProperty('transition', 'none', 'important');
  return { applied: true, side, count: candidates.length };
}

// Fast path for drags: the full resolver above walks the whole document.
// Once it has tagged the chosen image (data-cfb27-logo-side), later moves
// only need to update that element's transform - a few microseconds
// instead of a full DOM walk per pointer move.
function applyTeamLogoTransformFast(payload = {}) {
  const side = payload.side === 'home' ? 'home' : 'away';
  const value = payload.transform && typeof payload.transform === 'object' ? payload.transform : {};
  const finite = (candidate, fallback) => Number.isFinite(Number(candidate)) ? Number(candidate) : fallback;
  const x = Math.max(-2000, Math.min(2000, finite(value.x, 0)));
  const y = Math.max(-2000, Math.min(2000, finite(value.y, 0)));
  const scale = Math.max(0.1, Math.min(5, finite(value.scale, 1.13)));
  const rotation = Math.max(-180, Math.min(180, finite(value.rotation, 0)));
  // Only a VISIBLE tagged image may take the fast path. Themes that keep
  // the bound logo hidden and mirror it into a visible copy can leave the
  // tag on the hidden one; moving that does nothing on screen. Prefer the
  // live copy, then any painted tagged image; otherwise fall back to the
  // full resolver.
  const tagged = Array.from(document.querySelectorAll('[data-cfb27-logo-side="' + side + '"]'));
  const painted = tagged.filter((candidate) => {
    if (!candidate.isConnected) return false;
    const box = candidate.getBoundingClientRect?.();
    if (!box || (box.width === 0 && box.height === 0)) return false;
    const style = getComputedStyle(candidate);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.01;
  });
  const image = painted.find((candidate) => candidate.getAttribute('data-cfb27-live-logo') === side) || painted[0];
  if (!image) return { applied: false, side, fast: false };
  image.dataset.cfb27LogoScale = String(scale);
  image.dataset.cfb27LogoX = String(x);
  image.dataset.cfb27LogoY = String(y);
  image.dataset.cfb27LogoRotation = String(rotation);
  image.style.setProperty('transform', 'translate(' + x + 'px, ' + y + 'px) rotate(' + rotation + 'deg) scale(' + scale + ')', 'important');
  image.style.setProperty('transition', 'none', 'important');
  return { applied: true, side, fast: true };
}

// Serialized into the theme guest. It measures the real painted logo after
// authored layout, host replacement, user movement, scaling, and rotation.
function measureTeamLogoGeometryInDocument(sideValue) {
  const side = sideValue === 'home' ? 'home' : 'away';
  const roots = [document];
  const visited = new Set();
  const images = [];
  while (roots.length) {
    const root = roots.shift();
    if (!root || visited.has(root)) continue;
    visited.add(root);
    for (const element of Array.from(root.querySelectorAll?.('*') || [])) {
      if (element.shadowRoot) roots.push(element.shadowRoot);
      if (element.matches?.('img, image')) images.push(element);
    }
  }
  const explicit = [];
  for (const root of visited) {
    const binding = root.querySelector?.('[data-cfb27-import-dynamic="' + side + '.logo"], [data-cfb27-bind="' + side + '.logo"]');
    if (binding) explicit.push(binding.matches?.('img, image') ? binding : binding.querySelector?.('img, image'));
  }
  const candidates = Array.from(new Set([
    ...images.filter((image) => image.getAttribute?.('data-cfb27-logo-side') === side),
    ...images.filter((image) => image.getAttribute?.('data-cfb27-live-logo') === side),
    ...explicit,
  ].filter(Boolean)));
  const visible = candidates.filter((image) => {
    const box = image.getBoundingClientRect?.();
    const style = getComputedStyle(image);
    return box && box.width > 0 && box.height > 0
      && style.display !== 'none'
      && style.visibility !== 'hidden'
      && Number(style.opacity || 1) > 0.01;
  });
  if (!visible.length) return null;
  const image = side === 'home' ? visible[visible.length - 1] : visible[0];
  const box = image.getBoundingClientRect();
  const style = getComputedStyle(image);
  const layoutWidth = Number(image.clientWidth || image.offsetWidth) || box.width;
  const layoutHeight = Number(image.clientHeight || image.offsetHeight) || box.height;
  const naturalWidth = Number(image.naturalWidth || image.width?.baseVal?.value) || layoutWidth;
  const naturalHeight = Number(image.naturalHeight || image.height?.baseVal?.value) || layoutHeight;
  let paintedWidth = layoutWidth;
  let paintedHeight = layoutHeight;
  const objectFit = String(style.objectFit || 'fill').toLowerCase();
  if (naturalWidth > 0 && naturalHeight > 0 && layoutWidth > 0 && layoutHeight > 0) {
    if (objectFit === 'contain' || objectFit === 'scale-down') {
      let ratio = Math.min(layoutWidth / naturalWidth, layoutHeight / naturalHeight);
      if (objectFit === 'scale-down') ratio = Math.min(1, ratio);
      paintedWidth = naturalWidth * ratio;
      paintedHeight = naturalHeight * ratio;
    } else if (objectFit === 'cover') {
      const ratio = Math.max(layoutWidth / naturalWidth, layoutHeight / naturalHeight);
      paintedWidth = naturalWidth * ratio;
      paintedHeight = naturalHeight * ratio;
    } else if (objectFit === 'none') {
      paintedWidth = naturalWidth;
      paintedHeight = naturalHeight;
    }
  }
  let a = 1;
  let b = 0;
  let c = 0;
  let d = 1;
  try {
    const Matrix = window.DOMMatrixReadOnly || window.DOMMatrix;
    if (Matrix && style.transform && style.transform !== 'none') {
      const matrix = new Matrix(style.transform);
      a = Number(matrix.a) || 0;
      b = Number(matrix.b) || 0;
      c = Number(matrix.c) || 0;
      d = Number(matrix.d) || 0;
    }
  } catch { /* The element box below remains a safe fallback. */ }
  const halfWidth = (Math.abs(a) * paintedWidth / 2) + (Math.abs(c) * paintedHeight / 2);
  const halfHeight = (Math.abs(b) * paintedWidth / 2) + (Math.abs(d) * paintedHeight / 2);
  const centerX = box.left + (box.width / 2);
  const centerY = box.top + (box.height / 2);
  const measuredWidth = halfWidth * 2;
  const measuredHeight = halfHeight * 2;
  return measuredWidth > 0 && measuredHeight > 0
    ? { x: centerX - halfWidth, y: centerY - halfHeight, width: measuredWidth, height: measuredHeight }
    : { x: box.left, y: box.top, width: box.width, height: box.height };
}

async function reportTeamLogoGeometry() {
  if (!themeReady || !currentStatus?.quickSettingsOpen) return;
  try {
    const measure = measureTeamLogoGeometryInDocument.toString();
    const result = await themeView.executeJavaScript(`(() => { const measure = ${measure}; return { away: measure('away'), home: measure('home') }; })()`);
    const themeRect = themeView.getBoundingClientRect();
    const scaleX = themeView.offsetWidth > 0 ? themeRect.width / themeView.offsetWidth : Number(currentLayout.scale) || 1;
    const scaleY = themeView.offsetHeight > 0 ? themeRect.height / themeView.offsetHeight : Number(currentLayout.scale) || 1;
    await Promise.all(['away', 'home'].map((side) => {
      const box = result?.[side];
      return window.overlayControl.reportTeamLogoGeometry(box ? {
        side,
        seq: lastAppliedLogoSeq[side],
        visible: true,
        bounds: {
          x: themeRect.left + (Number(box.x) * scaleX),
          y: themeRect.top + (Number(box.y) * scaleY),
          width: Number(box.width) * scaleX,
          height: Number(box.height) * scaleY,
        },
      } : { side, seq: lastAppliedLogoSeq[side], visible: false });
    }));
  } catch (error) {
    setStatus(`Logo position guide unavailable: ${error.message}`);
  }
}

function scheduleTeamLogoGeometryReport() {
  if (logoGeometryFrame !== null) return;
  logoGeometryFrame = requestAnimationFrame(() => {
    logoGeometryFrame = null;
    reportTeamLogoGeometry();
  });
}

function guestBootstrapSource(state, layout = {}) {
  const serialized = JSON.stringify(JSON.stringify(state || {}));
  const preserveAuthoredCanvas = layout?.authoredCanvas === true;
  const logoSourceSetter = window.CFB27LogoSource.setLogoSourceIfChanged.toString();
  const claudeDcStateSetter = window.CFB27ClaudeDcBridge.applyClaudeDcScoreboardState.toString();
  const logoTransformSetter = applyTeamLogoTransformToDocument.toString();
  return `(() => {
    const nextState = JSON.parse(${serialized});
    const preserveAuthoredCanvas = ${JSON.stringify(preserveAuthoredCanvas)};
    const setLogoSourceIfChanged = ${logoSourceSetter};
    const applyClaudeDcScoreboardState = ${claudeDcStateSetter};
    const applyTeamLogoTransformToDocument = ${logoTransformSetter};
    const read = (object, path) => path.split('.').reduce((value, key) => value == null ? value : value[key], object);
    const visible = (element) => {
      if (!(element instanceof Element)) return false;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const visibleChildren = (element) => Array.from(element?.children || []).filter(visible);
    const coreBindings = [
      'away.rank', 'away.name', 'away.record', 'away.score',
      'home.rank', 'home.name', 'home.record', 'home.score',
      'game.quarter', 'game.clock', 'game.playClock', 'game.downDistance',
    ];
    const trackedBindings = window.__CFB27_TRACKED_BINDINGS__ instanceof Set
      ? window.__CFB27_TRACKED_BINDINGS__
      : new Set(coreBindings);
    window.__CFB27_TRACKED_BINDINGS__ = trackedBindings;
    document.querySelectorAll('[data-cfb27-import-dynamic]').forEach((element) => {
      const binding = element.getAttribute('data-cfb27-import-dynamic');
      if (binding) trackedBindings.add(binding);
    });
    const bindingsReady = () => Array.from(trackedBindings).every((binding) => {
      const element = document.querySelector('[data-cfb27-import-dynamic="' + binding + '"]');
      return Boolean(element?.isConnected);
    });
    const mark = (element, binding) => {
      if (element && !element.hasAttribute('data-cfb27-import-dynamic')) {
        element.setAttribute('data-cfb27-import-dynamic', binding);
      }
      if (element?.getAttribute('data-cfb27-import-dynamic') === binding) {
        trackedBindings.add(binding);
      }
      return element;
    };
    const isolateScorebug = (root) => {
      if (!root || root.dataset.cfb27OverlayIsolated === 'true') return;

      const styleId = 'cfb27-overlay-isolation';
      let style = document.getElementById(styleId);
      if (!style) {
        style = document.createElement('style');
        style.id = styleId;
        style.textContent = [
          'html,body{margin:0!important;padding:0!important;width:100%!important;height:100%!important;min-height:0!important;background:transparent!important;overflow:hidden!important}',
          '[data-cfb27-overlay-root]{position:fixed!important;left:0!important;top:0!important;margin:0!important;transform:none!important;transform-origin:top left!important;z-index:2147483647!important}',
        ].join('');
        (document.head || document.documentElement).appendChild(style);
      }

      root.setAttribute('data-cfb27-overlay-root', '');
      root.dataset.cfb27OverlayIsolated = 'true';

      // Standalone exports can wrap the scorebug in full-page previews,
      // reference images and control panels. Keep the ancestor chain alive so
      // authored custom elements continue working, but hide every sibling.
      let child = root;
      let parent = root.parentElement;
      while (parent && parent !== document.body) {
        Array.from(parent.children).forEach((sibling) => {
          if (sibling !== child) sibling.style.setProperty('display', 'none', 'important');
        });
        parent.style.setProperty('margin', '0', 'important');
        parent.style.setProperty('padding', '0', 'important');
        parent.style.setProperty('min-height', '0', 'important');
        parent.style.setProperty('width', 'auto', 'important');
        parent.style.setProperty('height', 'auto', 'important');
        parent.style.setProperty('display', 'block', 'important');
        parent.style.setProperty('overflow', 'visible', 'important');
        child = parent;
        parent = parent.parentElement;
      }
      if (document.body) {
        Array.from(document.body.children).forEach((sibling) => {
          if (sibling !== child && sibling.tagName !== 'SCRIPT') {
            sibling.style.setProperty('display', 'none', 'important');
          }
        });
      }
    };
    const fitTeamHeading = (side) => {
      const field = (name) => document.querySelector('[data-cfb27-import-dynamic="' + side + '.' + name + '"]');
      const rank = field('rank');
      const name = field('name');
      const record = field('record');
      const heading = name?.parentElement;
      if (!heading || !rank || !record) return;

      rank.style.setProperty('white-space', 'nowrap', 'important');
      rank.style.setProperty('flex-shrink', '0', 'important');
      record.style.setProperty('white-space', 'nowrap', 'important');
      record.style.setProperty('flex-shrink', '0', 'important');
      name.style.setProperty('white-space', 'nowrap', 'important');
      name.style.setProperty('flex-shrink', '0', 'important');

      const computedSize = parseFloat(getComputedStyle(name).fontSize) || 42;
      const baseSize = Number(name.dataset.cfb27BaseFontSize) || computedSize;
      name.dataset.cfb27BaseFontSize = String(baseSize);
      let size = baseSize;
      name.style.setProperty('font-size', size + 'px', 'important');
      while (heading.scrollWidth > heading.clientWidth + 1 && size > 25) {
        size -= 1;
        name.style.setProperty('font-size', size + 'px', 'important');
      }
      if (heading.scrollWidth > heading.clientWidth + 1) {
        name.style.setProperty('min-width', '0', 'important');
        name.style.setProperty('flex-shrink', '1', 'important');
        name.style.setProperty('overflow', 'hidden', 'important');
        name.style.setProperty('text-overflow', 'ellipsis', 'important');
      }
    };
    const descendants = (element) => Array.from(element?.querySelectorAll('*') || []).filter(visible);
    const largestText = (element, excluded = []) => descendants(element)
      .filter((candidate) => candidate.textContent.trim().length > 0)
      .filter((candidate) => !excluded.some((item) => item && (item === candidate || item.contains(candidate))))
      .sort((left, right) => parseFloat(getComputedStyle(right).fontSize) - parseFloat(getComputedStyle(left).fontSize))[0] || null;
    const bindingElement = (name) => document.querySelector('[data-cfb27-import-dynamic="' + name + '"]');
    const shadeColor = (hex, amount) => {
      const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
      const shifted = channels.map((channel) => Math.max(0, Math.min(255, Math.round(
        amount >= 0 ? channel + ((255 - channel) * amount) : channel * (1 + amount),
      ))));
      return 'rgb(' + shifted.join(', ') + ')';
    };
    const applyTeamColor = (side, value) => {
      if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) return;
      const explicitColor = document.querySelector(
        '[data-cfb27-import-dynamic="' + side + '.color"], [data-cfb27-bind="' + side + '.color"]',
      );
      if (explicitColor) {
        const root = explicitColor.closest('[data-cfb27-scorebug], [data-cfb27-overlay-root]');
        root?.style.setProperty('--' + side, value);
        explicitColor.style.setProperty('background-color', value, 'important');
        return;
      }
      const row = document.querySelector('[data-cfb27-team-row="' + side + '"]');
      if (!row) return;
      const gradient = 'linear-gradient(165deg, '
        + shadeColor(value, 0.16) + ' 0%, '
        + value + ' 48%, '
        + shadeColor(value, -0.2) + ' 100%)';
      row.style.setProperty('background', gradient, 'important');
    };
    const enlargeLiveLogo = (image) => {
      if (!image) return;
      if (!image.dataset.cfb27LogoBaseWidth) {
        image.dataset.cfb27LogoBaseWidth = String(image.offsetWidth || 0);
        image.dataset.cfb27LogoBaseHeight = String(image.offsetHeight || 0);
      }
      // Keep the authored logo slot and every neighboring field in place.
      // Keep every alpha-cropped logo centered inside the authored team slot.
      image.dataset.cfb27LogoScale = '1.13';
      image.dataset.cfb27LogoX = '0';
      image.dataset.cfb27LogoY = '0';
      image.style.setProperty('transform', 'translate(0px, 0px) scale(1.13)', 'important');
      image.style.setProperty('transform-origin', 'center', 'important');
      image.style.setProperty('object-position', 'center center', 'important');
      image.style.setProperty('image-rendering', 'auto', 'important');
    };
    const updateLogo = (element, side, value) => {
      if (!element) return;
      const hasLogo = typeof value === 'string' && value.trim().length > 0;
      const image = element.matches('img, image') ? element : element.querySelector('img, image');
      if (image) {
        // Some authored themes keep the bound image invisible and mirror its
        // source into a visible sibling. Treat that sibling as the real logo
        // surface so transparent pixels reveal only the authored canvas, not a
        // host-added team-color rectangle, and so move/scale/rotate target what
        // the viewer can actually see.
        const companion = image.parentElement?.querySelector?.(':scope > img.logoView');
        if (companion && companion !== image) {
          companion.dataset.cfb27LiveLogo = side;
          companion.alt = '';
          companion.style.setProperty('display', hasLogo ? 'block' : 'none', 'important');
          companion.style.setProperty('visibility', hasLogo ? 'visible' : 'hidden', 'important');
          companion.style.setProperty('opacity', hasLogo ? '1' : '0', 'important');
          companion.style.setProperty('background', 'none', 'important');
          companion.style.setProperty('background-color', 'transparent', 'important');
          companion.style.setProperty('background-image', 'none', 'important');
          companion.style.setProperty('box-shadow', 'none', 'important');
          companion.style.setProperty('object-fit', 'contain', 'important');
          companion.style.setProperty('object-position', 'center center', 'important');
          enlargeLiveLogo(companion);
          setLogoSourceIfChanged(companion, value);
          element.style.setProperty('visibility', 'hidden', 'important');
          return;
        }
        enlargeLiveLogo(image);
        element.style.visibility = hasLogo ? 'visible' : 'hidden';
        setLogoSourceIfChanged(image, value);
        return;
      }

      // Claude standalone exports render logo slots as custom elements. Put a
      // normal image over that slot so a live PNG works even when its authored
      // component keeps the original artwork inside a closed shadow root.
      if (element.tagName.includes('-') && element.parentElement) {
        const host = element.parentElement;
        if (getComputedStyle(host).position === 'static') host.style.setProperty('position', 'relative', 'important');
        let liveImage = host.querySelector(':scope > img[data-cfb27-live-logo="' + side + '"]');
        if (!liveImage) {
          liveImage = document.createElement('img');
          liveImage.dataset.cfb27LiveLogo = side;
          liveImage.alt = '';
          liveImage.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:center;z-index:20;pointer-events:none;';
          host.appendChild(liveImage);
        }
        enlargeLiveLogo(liveImage);
        element.style.setProperty('visibility', 'hidden', 'important');
        liveImage.style.display = hasLogo ? 'block' : 'none';
        setLogoSourceIfChanged(liveImage, value);
        return;
      }

      if (getComputedStyle(element).position === 'static') element.style.setProperty('position', 'relative', 'important');
      let liveImage = element.querySelector(':scope > img[data-cfb27-live-logo="' + side + '"]');
      if (!liveImage) {
        liveImage = document.createElement('img');
        liveImage.dataset.cfb27LiveLogo = side;
        liveImage.alt = '';
        liveImage.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:center;z-index:20;pointer-events:none;';
        element.appendChild(liveImage);
      }
      enlargeLiveLogo(liveImage);
      element.style.visibility = hasLogo ? 'visible' : 'hidden';
      element.style.setProperty('color', 'transparent', 'important');
      element.style.setProperty('border-color', 'transparent', 'important');
      liveImage.style.display = hasLogo ? 'block' : 'none';
      setLogoSourceIfChanged(liveImage, value);
    };
    const ensurePossessionBinding = (side, otherSide, row) => {
      if (bindingElement(side + '.possession')) return;
      const template = bindingElement(otherSide + '.possession');
      const score = bindingElement(side + '.score');
      if (!template || !score || !row) return;

      // Some standalone exports use a conditional component for possession,
      // so only the initially active team's triangle exists in the DOM. Clone
      // that authored triangle into the other score row; the live bridge then
      // controls the two copies with visibility without editing the HTML file.
      let container = score.parentElement;
      while (container && container !== row) {
        const display = getComputedStyle(container).display;
        if (display === 'flex' || display === 'inline-flex') break;
        container = container.parentElement;
      }
      if (!container || container === row) container = score.parentElement;
      if (!container) return;
      const clone = template.cloneNode(true);
      clone.removeAttribute('data-cfb27-import-dynamic');
      clone.dataset.cfb27GeneratedPossession = side;
      clone.style.setProperty('visibility', 'hidden', 'important');
      container.appendChild(clone);
      mark(clone, side + '.possession');
    };
    const liveScoreDigitCount = (value, score) => {
      const displayed = value === undefined || value === null
        ? String(score?.textContent || '')
        : String(value);
      const digits = displayed.match(/\\d/g);
      return Math.max(1, digits?.length || 0);
    };
    const measureNaturalScoreWidth = (score, scoreItem) => {
      // The lane is deliberately kept at the widest score seen so that logos,
      // headings and any authored siblings never reflow. Measure the current
      // number at max-content width, then restore the lane synchronously before
      // Chromium can paint the temporary measurement state.
      const nodes = Array.from(new Set([scoreItem, score].filter(Boolean)));
      const properties = ['width', 'min-width', 'max-width', 'flex-basis'];
      const saved = nodes.map((node) => ({
        node,
        values: properties.map((property) => ({
          property,
          value: node.style.getPropertyValue(property),
          priority: node.style.getPropertyPriority(property),
        })),
      }));
      for (const node of nodes) {
        node.style.setProperty('width', 'max-content', 'important');
        node.style.setProperty('min-width', '0', 'important');
        node.style.setProperty('max-width', 'none', 'important');
        node.style.setProperty('flex-basis', 'auto', 'important');
      }
      const width = Math.max(1, Math.ceil(score.scrollWidth || score.offsetWidth || 0));
      for (const entry of saved) {
        for (const property of entry.values) {
          if (property.value) entry.node.style.setProperty(property.property, property.value, property.priority);
          else entry.node.style.removeProperty(property.property);
        }
      }
      return width;
    };
    const stabilizeScoreAndPossession = (side, liveScore) => {
      const score = bindingElement(side + '.score');
      const possession = bindingElement(side + '.possession');
      if (!score || !possession) return;

      const digitCount = liveScoreDigitCount(liveScore, score);
      score.dataset.cfb27ScoreDigits = String(digitCount);

      // Explicit templates may intentionally place both fields with absolute
      // coordinates. Their authored lanes already prevent overlap; wrapping
      // those elements in a flex column would destroy that layout.
      if (getComputedStyle(score).position === 'absolute'
        || getComputedStyle(possession).position === 'absolute') {
        score.style.setProperty('white-space', 'nowrap', 'important');
        score.style.setProperty('font-variant-numeric', 'tabular-nums', 'important');
        if (!possession.dataset.cfb27AuthoredLeft) {
          possession.dataset.cfb27AuthoredLeft = getComputedStyle(possession).left;
          possession.dataset.cfb27AuthoredRight = getComputedStyle(possession).right;
          possession.dataset.cfb27AuthoredTransform = getComputedStyle(possession).transform;
          const firstScoreRect = score.getBoundingClientRect();
          const firstPossessionRect = possession.getBoundingClientRect();
          possession.dataset.cfb27ArrowDirection = firstPossessionRect.left >= firstScoreRect.left ? '1' : '-1';
        }
        possession.style.setProperty('left', possession.dataset.cfb27AuthoredLeft, 'important');
        possession.style.setProperty('right', possession.dataset.cfb27AuthoredRight, 'important');
        const naturalScoreWidth = measureNaturalScoreWidth(score, score);
        const protectedScoreWidth = Math.max(1, Math.ceil(naturalScoreWidth * 1.12 + 2));
        const referenceWidth = Number(possession.dataset.cfb27ReferenceScoreWidth);
        if (!Number.isFinite(referenceWidth) || referenceWidth <= 0) {
          possession.dataset.cfb27ReferenceScoreWidth = String(protectedScoreWidth);
        }
        const authoredTransform = possession.dataset.cfb27AuthoredTransform;
        const direction = Number(possession.dataset.cfb27ArrowDirection) < 0 ? -1 : 1;
        const baseWidth = Number(possession.dataset.cfb27ReferenceScoreWidth) || protectedScoreWidth;
        let arrowShift = direction * (protectedScoreWidth - baseWidth);
        const baseTransform = authoredTransform && authoredTransform !== 'none' ? ' ' + authoredTransform : '';
        possession.style.setProperty('transform', 'translateX(' + arrowShift + 'px)' + baseTransform, 'important');

        // Keep at least the authored eight-pixel safety gap even when a custom
        // absolute theme starts with a score/arrow collision.
        const scoreRect = score.getBoundingClientRect();
        const possessionRect = possession.getBoundingClientRect();
        if (direction > 0 && possessionRect.left < scoreRect.right + 8) {
          arrowShift += scoreRect.right + 8 - possessionRect.left;
        } else if (direction < 0 && possessionRect.right > scoreRect.left - 8) {
          arrowShift -= possessionRect.right - (scoreRect.left - 8);
        }
        possession.style.setProperty('transform', 'translateX(' + arrowShift + 'px)' + baseTransform, 'important');
        possession.dataset.cfb27ScoreDigits = String(digitCount);
        possession.dataset.cfb27ArrowShift = String(arrowShift);
        return;
      }

      // Use the closest score ancestor that also owns the arrow. This keeps
      // each imported theme's authored row positioning while separating the
      // numeric score and possession marker into independent flex items.
      let scoreGroup = score.parentElement;
      while (scoreGroup && !scoreGroup.contains(possession)) scoreGroup = scoreGroup.parentElement;
      if (!scoreGroup) return;

      let scoreItem = score;
      while (scoreItem.parentElement && scoreItem.parentElement !== scoreGroup) {
        scoreItem = scoreItem.parentElement;
      }

      // A direct score element needs an inert lane wrapper. The wrapper keeps
      // the row geometry stable while the arrow alone slides to the current
      // score width. Existing clip/wrapper elements are reused unchanged.
      if (scoreItem === score) {
        const lane = document.createElement('span');
        lane.dataset.cfb27ScoreLane = side;
        scoreGroup.insertBefore(lane, score);
        lane.appendChild(score);
        scoreItem = lane;
      } else {
        scoreItem.dataset.cfb27ScoreLane = side;
      }

      let column = possession.closest('[data-cfb27-possession-column]');
      if (!column || column.parentElement !== scoreGroup) {
        column = document.createElement('span');
        column.dataset.cfb27PossessionColumn = side;
        scoreGroup.insertBefore(column, possession);
        column.appendChild(possession);
      }

      scoreGroup.style.setProperty('display', 'flex', 'important');
      scoreItem.style.setProperty('flex', '0 0 auto', 'important');
      scoreItem.style.setProperty('min-width', '0', 'important');
      score.style.setProperty('display', 'inline-block', 'important');
      score.style.setProperty('width', 'max-content', 'important');
      score.style.setProperty('min-width', '0', 'important');
      score.style.setProperty('max-width', 'none', 'important');
      score.style.setProperty('white-space', 'nowrap', 'important');
      score.style.setProperty('font-variant-numeric', 'tabular-nums', 'important');
      const naturalScoreWidth = measureNaturalScoreWidth(score, scoreItem);
      const currentProtectedWidth = Math.max(1, Math.ceil(naturalScoreWidth * 1.12 + 2));
      const cachedLaneWidth = Number(scoreItem.dataset.cfb27ProtectedScoreWidth);
      // On a one-digit initial state, pre-reserve an estimated two-digit lane.
      // This prevents the rest of an imported flex row from jumping later.
      const initialLaneWidth = digitCount === 1
        ? Math.max(currentProtectedWidth, Math.ceil(naturalScoreWidth * 2 * 1.12 + 2))
        : currentProtectedWidth;
      const protectedLaneWidth = Number.isFinite(cachedLaneWidth) && cachedLaneWidth > 0
        ? Math.max(cachedLaneWidth, currentProtectedWidth)
        : initialLaneWidth;
      const arrowShift = currentProtectedWidth - protectedLaneWidth;
      scoreItem.dataset.cfb27ProtectedScoreWidth = String(protectedLaneWidth);
      scoreItem.dataset.cfb27CurrentScoreWidth = String(currentProtectedWidth);
      scoreItem.dataset.cfb27ScoreDigits = String(digitCount);
      scoreItem.style.setProperty('width', protectedLaneWidth + 'px', 'important');
      scoreItem.style.setProperty('min-width', protectedLaneWidth + 'px', 'important');
      scoreItem.style.setProperty('flex-basis', protectedLaneWidth + 'px', 'important');
      scoreItem.style.setProperty('overflow', 'visible', 'important');

      column.style.setProperty('display', 'flex', 'important');
      column.style.setProperty('align-items', 'center', 'important');
      column.style.setProperty('justify-content', 'center', 'important');
      column.style.setProperty('align-self', 'stretch', 'important');
      column.style.setProperty('box-sizing', 'border-box', 'important');
      column.style.setProperty('flex', '0 0 33px', 'important');
      column.style.setProperty('width', '33px', 'important');
      column.style.setProperty('min-width', '33px', 'important');
      column.style.setProperty('max-width', '33px', 'important');
      column.style.setProperty('overflow', 'visible', 'important');
      column.style.setProperty('pointer-events', 'none', 'important');
      column.style.setProperty('transform', 'translateX(' + arrowShift + 'px)', 'important');
      column.style.setProperty('transform-origin', 'left center', 'important');
      column.dataset.cfb27ScoreDigits = String(digitCount);
      column.dataset.cfb27ArrowShift = String(arrowShift);
      possession.style.setProperty('flex', '0 0 auto', 'important');
      possession.style.setProperty('margin', '0', 'important');
      possession.style.setProperty('align-self', 'center', 'important');
    };
    const bindLegacyTheme = () => {
      if (bindingsReady()) return true;

      const rememberedRoot = window.__CFB27_THEME_ROOT__;
      const explicitRoot = rememberedRoot?.isConnected
        ? rememberedRoot
        : document.querySelector('[data-cfb27-scorebug], [data-cfb27-overlay-root]');
      const candidates = Array.from(document.querySelectorAll('body *')).filter((element) => {
        if (!visible(element)) return false;
        const box = element.getBoundingClientRect();
        const direct = visibleChildren(element);
        if (box.width < 280 || box.width > 850 || box.height < 280 || box.height > 950) return false;
        if (direct.length < 4 || direct.length > 8) return false;
        const heights = direct.slice(0, 4).map((child) => child.getBoundingClientRect().height);
        return heights.length === 4
          && Math.abs(heights[0] - heights[1]) < Math.max(12, heights[0] * 0.15)
          && heights[0] > heights[2] * 1.8
          && heights[0] > heights[3] * 1.8;
      });
      candidates.sort((left, right) => {
        const score = (element) => {
          const box = element.getBoundingClientRect();
          const direct = visibleChildren(element);
          return (direct.length === 4 ? 100 : 0)
            - Math.abs(box.width - 371) * 0.12
            - Math.abs(box.height - 433) * 0.08;
        };
        return score(right) - score(left);
      });
      const root = explicitRoot || candidates[0];
      if (!root) return false;

      // Declared-canvas themes already place their scorebug inside the authored
      // viewport. Pinning that root to 0,0 clips logos/ranks that intentionally
      // extend above or beside it. Only isolate legacy themes that need it.
      if (!preserveAuthoredCanvas) isolateScorebug(root);

      const directRows = visibleChildren(root);
      const explicit = (binding) => root.querySelector('[data-cfb27-bind="' + binding + '"]');
      const rows = {
        away: root.querySelector('[data-cfb27-row="away"]')
          || explicit('away.color')?.parentElement
          || directRows[0],
        home: root.querySelector('[data-cfb27-row="home"]')
          || explicit('home.color')?.parentElement
          || directRows[1],
        info: root.querySelector('[data-cfb27-row="info"]') || directRows[2],
        down: root.querySelector('[data-cfb27-row="down"]') || directRows[3],
      };
      if (!rows.away || !rows.home || !rows.info || !rows.down) return false;

      const mapTeam = (row, side, ordinal) => {
        const colorBinding = explicit(side + '.color');
        if (colorBinding) colorBinding.dataset.cfb27TeamColorBinding = side;
        else row.dataset.cfb27TeamRow = side;
        const header = visibleChildren(row).find((candidate) => {
          const textChildren = visibleChildren(candidate).filter((child) => child.textContent.trim().length > 0);
          return textChildren.length >= 3;
        });
        const headerFields = header ? visibleChildren(header).filter((child) => child.textContent.trim().length > 0) : [];
        const timeoutContainer = explicit(side + '.timeouts') || visibleChildren(row).find((candidate) => {
          const bars = visibleChildren(candidate).filter((child) => {
            const box = child.getBoundingClientRect();
            return box.width >= 8 && box.height > 0 && box.height <= 20;
          });
          return bars.length >= 3;
        });
        const logoSeed = explicit(side + '.logo') || row.querySelector('#logo' + ordinal) || row.querySelector('[id*="logo" i]');
        const excluded = [header, timeoutContainer, logoSeed];
        const possession = explicit(side + '.possession') || descendants(row).find((candidate) => {
          const style = getComputedStyle(candidate);
          return parseFloat(style.width || '0') <= 2
            && parseFloat(style.height || '0') <= 2
            && parseFloat(style.borderRightWidth || '0') >= 10
            && parseFloat(style.borderTopWidth || '0') >= 8;
        });

        mark(explicit(side + '.rank') || headerFields[0], side + '.rank');
        mark(explicit(side + '.name') || headerFields[1], side + '.name');
        mark(explicit(side + '.nickname') || explicit(side + '.mascot'), side + '.nickname');
        mark(explicit(side + '.record') || headerFields[2], side + '.record');
        mark(timeoutContainer, side + '.timeouts');
        mark(explicit(side + '.score') || largestText(row, excluded), side + '.score');
        mark(possession, side + '.possession');
        mark(logoSeed, side + '.logo');
      };

      mapTeam(rows.away, 'away', 1);
      mapTeam(rows.home, 'home', 2);
      ensurePossessionBinding('away', 'home', rows.away);
      ensurePossessionBinding('home', 'away', rows.home);
      const info = visibleChildren(rows.info);
      mark(explicit('game.quarter') || info[0], 'game.quarter');
      mark(explicit('game.clock') || info[1], 'game.clock');
      mark(explicit('game.playClock') || info[2], 'game.playClock');
      mark(explicit('game.downDistance') || largestText(rows.down), 'game.downDistance');
      root.setAttribute('data-cfb27-import-root', explicitRoot ? 'explicit' : 'legacy-structure');
      return bindingsReady();
    };
    const stopLegacyWatchers = () => {
      if (window.__CFB27_BINDING_OBSERVER__) {
        window.__CFB27_BINDING_OBSERVER__.disconnect();
        window.__CFB27_BINDING_OBSERVER__ = null;
      }
      if (window.__CFB27_BINDING_RETRY__) {
        clearInterval(window.__CFB27_BINDING_RETRY__);
        window.__CFB27_BINDING_RETRY__ = null;
      }
    };
    const render = (state) => {
      window.__CFB27_SCOREBOARD_STATE__ = state;
      const dcReport = applyClaudeDcScoreboardState(window, state);
      window.__CFB27_CLAUDE_DC_REPORT__ = dcReport;
      if (dcReport.detected) {
        window.__CFB27_CLAUDE_DC_ACTIVE__ = true;
        stopLegacyWatchers();
      } else {
        bindLegacyTheme();
        // The score-lane stabiliser and the heading fit below both force a
        // synchronous relayout: they write inline styles, read scrollWidth and
        // restore. Under RAM data render() runs about once a second because the
        // clock ticks, and repeating that measurement on every tick is what
        // makes the imported scoreboard visibly re-fit itself. Redo it only when
        // an input it actually depends on has changed. The bootstrap clears this
        // signature, so a theme reload always remeasures from scratch.
        const geometrySignature = JSON.stringify([
          state.away?.score, state.home?.score,
          state.away?.rank, state.home?.rank,
          state.away?.name, state.home?.name,
          state.away?.shortName, state.home?.shortName,
          state.away?.record, state.home?.record,
        ]);
        const geometryChanged = window.__CFB27_GEOMETRY_SIGNATURE__ !== geometrySignature;
        window.__CFB27_GEOMETRY_SIGNATURE__ = geometrySignature;
        if (geometryChanged) {
          stabilizeScoreAndPossession('away', state.away?.score);
          stabilizeScoreAndPossession('home', state.home?.score);
        }
        applyTeamColor('away', state.away?.color);
        applyTeamColor('home', state.home?.color);
        document.querySelectorAll('[data-cfb27-import-dynamic]').forEach((element) => {
          const binding = element.getAttribute('data-cfb27-import-dynamic');
          const value = read(state, binding);
          if (binding.endsWith('.logo')) {
            updateLogo(element, binding.startsWith('away.') ? 'away' : 'home', value);
          } else if (binding.endsWith('.timeouts')) {
            const hasValue = value !== undefined && value !== null && Number.isFinite(Number(value));
            element.style.visibility = hasValue ? 'visible' : 'hidden';
            if (!hasValue) return;
            const count = Math.max(0, Math.min(3, Number(value) || 0));
            const indicators = Array.from(element.children);
            const firstRemaining = indicators.length - count;
            indicators.forEach((child, index) => {
              child.style.opacity = index >= firstRemaining ? '1' : '0.16';
            });
          } else if (binding.endsWith('.possession')) {
            element.style.setProperty('visibility', value ? 'visible' : 'hidden', 'important');
            element.style.setProperty('opacity', value ? '1' : '0', 'important');
          } else {
            element.textContent = value === undefined || value === null ? '' : String(value);
          }
        });
        if (geometryChanged) {
          // Reapply the stable two-digit lane after changing the score value.
          stabilizeScoreAndPossession('away', state.away?.score);
          stabilizeScoreAndPossession('home', state.home?.score);
          requestAnimationFrame(() => {
            fitTeamHeading('away');
            fitTeamHeading('home');
          });
        }
      }
      for (const side of ['away', 'home']) {
        applyTeamLogoTransformToDocument({
          side,
          logo: state?.[side]?.logo,
          transform: state?.meta?.teamLogoLayouts?.[side],
        });
      }
      window.dispatchEvent(new CustomEvent('cfb27-scoreboard-state', { detail: state }));
      document.dispatchEvent(new CustomEvent('cfb27-scoreboard-state', { detail: state }));
      return dcReport;
    };
    const authoredBridge = window.CFB27ScoreboardOverlay || window.CFBOverlay;
    if (authoredBridge && authoredBridge.hostManaged !== true && typeof authoredBridge.setState === 'function') {
      try { authoredBridge.setState(nextState); } catch (error) { console.warn('[CFB27 overlay] authored setState failed', error); }
    }
    if (!window.CFB27ScoreboardOverlay) {
      window.CFB27ScoreboardOverlay = Object.freeze({ setState: render, hostManaged: true });
    }
    // A fresh bootstrap means a new document or new bindings, so discard any
    // remembered geometry signature and let the first render remeasure.
    window.__CFB27_GEOMETRY_SIGNATURE__ = null;
    const initialDcReport = render(nextState);
    if (!initialDcReport.detected && !window.__CFB27_BINDING_OBSERVER__ && document.body) {
      let rebindTimer = null;
      window.__CFB27_BINDING_OBSERVER__ = new MutationObserver(() => {
        if (window.__CFB27_CLAUDE_DC_ACTIVE__) {
          stopLegacyWatchers();
          return;
        }
        clearTimeout(rebindTimer);
        rebindTimer = setTimeout(() => {
          if (!bindingsReady() && bindLegacyTheme()) {
            render(window.__CFB27_SCOREBOARD_STATE__ || nextState);
          }
        }, 25);
      });
      window.__CFB27_BINDING_OBSERVER__.observe(document.body, { childList: true, subtree: true });
    }
    if (!initialDcReport.detected && !bindingsReady() && !window.__CFB27_BINDING_RETRY__) {
      let attempts = 0;
      window.__CFB27_BINDING_RETRY__ = setInterval(() => {
        attempts += 1;
        const retryReport = render(window.__CFB27_SCOREBOARD_STATE__ || nextState);
        if (retryReport.detected || bindingsReady()) {
          clearInterval(window.__CFB27_BINDING_RETRY__);
          window.__CFB27_BINDING_RETRY__ = null;
        } else if (attempts >= 120) {
          clearInterval(window.__CFB27_BINDING_RETRY__);
          window.__CFB27_BINDING_RETRY__ = null;
        }
      }, 100);
    }
    return { ok: true, dcBridge: initialDcReport };
  })()`;
}

// guestBootstrapSource stringifies several large helpers, rescans the document
// for bindings and reinstalls the guest observers. Running it for every value
// change rebuilt the entire guest bridge once per clock tick once RAM data
// replaced OCR - the screen reader changed values rarely enough to hide it.
// Reuse the bridge the bootstrap already installed and send only the new state.
// Authored themes expose their own bridge with a contract we do not own, so
// they keep falling through to the full bootstrap exactly as before.
function guestStateUpdateSource(state) {
  const serialized = JSON.stringify(JSON.stringify(state || {}));
  return `(() => {
    const bridge = window.CFB27ScoreboardOverlay;
    if (!bridge || bridge.hostManaged !== true || typeof bridge.setState !== 'function') return false;
    bridge.setState(JSON.parse(${serialized}));
    return true;
  })()`;
}

async function pushStateToTheme() {
  updateMock(currentState);
  if (!themeReady || !currentState) return;
  try {
    const reusedBridge = await themeView.executeJavaScript(guestStateUpdateSource(currentState));
    if (!reusedBridge) {
      await themeView.executeJavaScript(guestBootstrapSource(currentState, currentLayout));
    }
    scheduleTeamLogoGeometryReport();
  } catch (error) {
    setStatus(`Theme state bridge unavailable: ${error.message}`);
  }
}

const logoPreviewInFlight = new Map();
const logoPreviewWaiting = new Map();
const lastAppliedLogoSeq = { away: 0, home: 0 };
async function previewTeamLogoTransform(payload) {
  if (!themeReady || !currentState || !payload?.side) return;
  const side = payload.side === 'home' ? 'home' : 'away';
  const request = { side, transform: payload.transform, seq: Number(payload.seq) || 0 };
  // Newest wins; never let two round-trips race so the logo cannot jump
  // backwards when an older move lands after a newer one.
  if (logoPreviewInFlight.get(side)) {
    logoPreviewWaiting.set(side, request);
    return;
  }
  logoPreviewInFlight.set(side, true);
  try {
    let current = request;
    while (current) {
      try {
        const fast = await themeView.executeJavaScript(`(${applyTeamLogoTransformFast.toString()})(${JSON.stringify(current)})`);
        if (!fast || !fast.applied) {
          await themeView.executeJavaScript(`(${applyTeamLogoTransformToDocument.toString()})(${JSON.stringify(current)})`);
        }
        lastAppliedLogoSeq[side] = Math.max(lastAppliedLogoSeq[side], Number(current.seq) || 0);
      } catch (error) {
        setStatus(`Logo adjustment failed: ${error.message}`);
      }
      current = logoPreviewWaiting.get(side) || null;
      logoPreviewWaiting.delete(side);
    }
    scheduleTeamLogoGeometryReport();
  } finally {
    logoPreviewInFlight.set(side, false);
  }
}

function showMock(message = 'Using safe mock scoreboard') {
  themeReady = false;
  overlay.classList.remove('has-theme', 'is-loading');
  setStatus(message);
  updateMock(currentState);
}

function loadTheme(themeUrl) {
  themeLoadToken += 1;
  themePreparationToken += 1;
  loadedThemeUrl = themeUrl || null;
  themeReady = false;
  overlay.classList.remove('has-theme');
  overlay.classList.add('is-loading');

  if (!loadedThemeUrl) {
    themeView.removeAttribute('src');
    showMock('No HTML selected — using safe mock');
    return;
  }

  setStatus('Loading scoreboard HTML…');
  themeView.src = loadedThemeUrl;
}

async function handleThemeLoaded() {
  const token = themeLoadToken;
  const preparationToken = ++themePreparationToken;
  try {
    await themeView.insertCSS(THEME_TRANSPARENCY_CSS);
    const metrics = await normalizeTheme(currentLayout, token, preparationToken);
    if (!metrics || token !== themeLoadToken || preparationToken !== themePreparationToken) return;

    // Keep the webview hidden until the live-state bridge has isolated the
    // selected root and a second fit confirms that isolation did not change its
    // geometry. This prevents a transient blank/zero-width box from being
    // promoted as a ready theme.
    themeReady = true;
    guestChromaSignature = '';
    pushChromaKeyToTheme(true);
    await pushStateToTheme();
    const settledMetrics = await normalizeTheme(currentLayout, token, preparationToken);
    if (!settledMetrics || token !== themeLoadToken || preparationToken !== themePreparationToken) return;
    overlay.classList.add('has-theme');
    overlay.classList.remove('is-loading');
    setStatus(`HTML theme fitted (${Math.round(settledMetrics.fitted.width)}×${Math.round(settledMetrics.fitted.height)})`);
  } catch (error) {
    if (token === themeLoadToken && preparationToken === themePreparationToken) {
      showMock(`Theme preparation failed: ${error.message}`);
    }
  }
}

function applyEditMode(enabled) {
  overlay.classList.toggle('is-editing', Boolean(enabled));
  if (enabled) {
    setStatus(currentStatus?.cropMode
      ? 'CROP MODE — drag the orange edges inward to remove dead space'
      : 'MOVE MODE — drag the green header or handles, then lock position');
  }
}

function applyCropMode(enabled) {
  const active = Boolean(enabled);
  overlay.classList.toggle('is-cropping', active);
  const toolbarButton = document.getElementById('toggle-crop');
  const quickButton = document.getElementById('quick-crop');
  toolbarButton.setAttribute('aria-pressed', String(active));
  toolbarButton.textContent = active ? 'Cropping' : 'Crop';
  quickButton.setAttribute('aria-pressed', String(active));
  quickButton.textContent = `Crop edges: ${active ? 'ON' : 'OFF'}`;
  document.getElementById('edit-mode-help').textContent = active
    ? 'Drag orange edges inward to remove dead space'
    : 'Drag the green border to resize smoothly';
  if (currentStatus?.editMode) applyEditMode(true);
}

function applyLayout(layout) {
  if (!layout) return;
  const canvasWidth = Number(layout.canvasWidth) || 371;
  const canvasHeight = Number(layout.canvasHeight) || 433;
  const scale = Number(layout.scale) || 1;
  const crop = {
    top: Math.max(0, Number(layout.crop?.top) || 0),
    right: Math.max(0, Number(layout.crop?.right) || 0),
    bottom: Math.max(0, Number(layout.crop?.bottom) || 0),
    left: Math.max(0, Number(layout.crop?.left) || 0),
  };
  const canvasChanged = canvasWidth !== currentLayout.canvasWidth
    || canvasHeight !== currentLayout.canvasHeight;
  currentLayout = { ...layout, canvasWidth, canvasHeight, scale, crop };
  document.documentElement.style.setProperty('--theme-width', `${canvasWidth}px`);
  document.documentElement.style.setProperty('--theme-height', `${canvasHeight}px`);
  document.documentElement.style.setProperty('--overlay-scale', String(scale));
  document.documentElement.style.setProperty('--theme-crop-x', `${crop.left * scale}px`);
  document.documentElement.style.setProperty('--theme-crop-y', `${crop.top * scale}px`);
  // Scale and crop are host-window presentation changes. Re-running the guest
  // HTML normalizer for every pointer move caused the old resize stutter.
  if (themeReady && canvasChanged) {
    const token = themeLoadToken;
    normalizeTheme(currentLayout, token)
      .then(() => pushStateToTheme())
      .catch((error) => {
        if (token === themeLoadToken) setStatus(`Theme fit failed: ${error.message}`);
      });
  }
}

function applyStatus(status) {
  if (!status) return;
  currentStatus = status;
  applyChromaKey(status.chromaKey || status.overlay?.chromaKey);
  applyQuickSettings(status.quickSettingsOpen);
  applyCropMode(status.cropMode);
  applyEditMode(status.editMode);
  applyLayout(status.layout);
  if (status.themeUrl !== loadedThemeUrl) loadTheme(status.themeUrl);
  if (status.quickSettingsOpen) scheduleTeamLogoGeometryReport();
}

themeView.addEventListener('did-finish-load', handleThemeLoaded);
themeView.addEventListener('did-fail-load', (event) => {
  if (event.isMainFrame === false) return;
  themePreparationToken += 1;
  showMock(`HTML load failed (${event.errorCode}): ${event.errorDescription}`);
});
themeView.addEventListener('render-process-gone', () => {
  themePreparationToken += 1;
  showMock('HTML renderer stopped — using safe mock');
});

document.getElementById('finish-edit').addEventListener('click', () => {
  const action = currentStatus?.quickSettingsOpen
    ? window.overlayControl.closeQuickSettings()
    : window.overlayControl.lockPosition();
  action.catch((error) => setStatus(error.message));
});

function toggleCropMode() {
  window.overlayControl.setCropMode(!currentStatus?.cropMode)
    .then(applyStatus)
    .catch((error) => setStatus(error.message));
}

document.getElementById('toggle-crop').addEventListener('click', toggleCropMode);

function resetCrop() {
  window.overlayControl.resetThemeCrop()
    .then(applyStatus)
    .catch((error) => setStatus(error.message));
}

document.getElementById('reset-crop').addEventListener('click', resetCrop);

document.querySelectorAll('[data-resize-handle]').forEach((handle) => {
  handle.addEventListener('pointerdown', startResize);
});
window.addEventListener('pointermove', continueResize);
window.addEventListener('pointerup', finishResize);
window.addEventListener('pointercancel', finishResize);

document.getElementById('quick-fresh-read').addEventListener('click', () => {
  window.overlayControl.freshRead()
    .then(() => setStatus('Fresh read started'))
    .catch((error) => setStatus(error.message));
});
document.getElementById('quick-crop').addEventListener('click', toggleCropMode);
document.getElementById('quick-reset-crop').addEventListener('click', resetCrop);
document.getElementById('quick-green-screen').addEventListener('click', () => {
  window.overlayControl.setGreenScreenEnabled(!currentChromaKey.enabled)
    .then(applyStatus)
    .catch((error) => setStatus(error.message));
});
document.getElementById('quick-follow-game').addEventListener('click', () => {
  window.overlayControl.followGame().catch((error) => setStatus(error.message));
});
document.getElementById('quick-finish').addEventListener('click', () => {
  window.overlayControl.closeQuickSettings().catch((error) => setStatus(error.message));
});

window.overlayControl.onStatus(applyStatus);
window.overlayControl.onEditMode(applyEditMode);
window.overlayControl.onLayout(applyLayout);
window.overlayControl.onTheme((theme) => loadTheme(theme?.themeUrl));
window.overlayControl.onReloadTheme((theme) => {
  if (theme?.themeUrl && theme.themeUrl !== loadedThemeUrl) loadTheme(theme.themeUrl);
  else if (themeReady) {
    themeLoadToken += 1;
    themePreparationToken += 1;
    themeReady = false;
    overlay.classList.remove('has-theme');
    overlay.classList.add('is-loading');
    themeView.reloadIgnoringCache();
  }
  else loadTheme(theme?.themeUrl || currentStatus?.themeUrl);
});
window.overlayControl.onState((state) => {
  currentState = state;
  overlay.classList.toggle('flag-active', currentState?.game?.flag === true);
  pushStateToTheme();
});
window.overlayControl.onTeamLogoTransform(previewTeamLogoTransform);

Promise.all([
  window.overlayControl.getState(),
  window.overlayControl.ready(),
]).then(([state, status]) => {
  currentState = state;
  updateMock(currentState);
  applyStatus(status);
}).catch((error) => {
  showMock(`Overlay startup fallback: ${error.message}`);
});
