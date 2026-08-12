(function exposeThemeFit(globalScope) {
  'use strict';

  function computeFit(input = {}) {
    // Keep this helper self-contained: the renderer serializes it into the
    // isolated theme webview, where module-scope helpers are unavailable.
    const positiveNumber = (value, fallback) => {
      const number = Number(value);
      return Number.isFinite(number) && number > 0 ? number : fallback;
    };
    const sourceWidth = positiveNumber(input.sourceWidth, 1);
    const sourceHeight = positiveNumber(input.sourceHeight, 1);
    const targetWidth = positiveNumber(input.targetWidth, sourceWidth);
    const targetHeight = positiveNumber(input.targetHeight, sourceHeight);
    const maximumScale = input.allowUpscale === true ? Number.POSITIVE_INFINITY : 1;
    const scale = Math.min(maximumScale, targetWidth / sourceWidth, targetHeight / sourceHeight);
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;

    return {
      scale,
      width,
      height,
      // Scorebugs are anchored to the same corner as their host window. Empty
      // space from a different aspect ratio therefore remains above/left.
      offsetX: Math.max(0, targetWidth - width),
      offsetY: Math.max(0, targetHeight - height),
    };
  }

  function scoreThemeRootCandidate(input = {}) {
    // Keep this helper self-contained too: overlay.js serializes it into the
    // isolated theme webview, where CommonJS/module-scope values do not exist.
    const finiteNumber = (value, fallback = 0) => {
      const number = Number(value);
      return Number.isFinite(number) ? number : fallback;
    };
    const width = finiteNumber(input.width);
    const height = finiteNumber(input.height);
    if (input.visible !== true || input.excluded === true || width <= 1 || height <= 1) {
      return Number.NEGATIVE_INFINITY;
    }

    // Root markers and already-normalized roots are promises from the theme
    // author/host. Structural guesses intentionally cannot outrank them.
    let score = 0;
    if (input.remembered === true) score += 5_000_000;
    else if (input.explicit === true) score += 4_500_000;
    else if (input.insideExplicit === true) score += 4_000_000;
    else if (input.legacyStructure === true) score += 3_500_000;
    else if (input.runtimeRoot === true) score += 3_000_000;
    else if (input.bindingRoot === true) score += 2_500_000;
    else if (input.semantic === true) score += 2_000_000;

    if (input.media === true) score += 180_000;
    if (input.customElement === true) score += 35_000;
    if (input.bodyChild === true) score += 20_000;
    if (input.painted === true) score += 12_000;
    if (input.hasBindings === true) score += 80_000;

    const directChildren = Math.max(0, Math.min(20, finiteNumber(input.directVisibleChildren)));
    const descendants = Math.max(0, Math.min(200, finiteNumber(input.visibleDescendants)));
    const textLength = Math.max(0, Math.min(500, finiteNumber(input.textLength)));
    const leafTextCount = Math.max(0, Math.min(24, finiteNumber(input.leafTextCount)));
    score += directChildren * 4_000;
    score += descendants * 90;
    score += textLength * 8;
    score += leafTextCount * 18_000;
    score += Math.log2(Math.max(4, width * height)) * 120;

    // A full-page preview with one smaller visual child is normally authoring
    // furniture, not the scorebug. This penalty lets the compact child win for
    // wide, tall and other non-2013 shapes without assuming an aspect ratio.
    const viewportCoverage = Math.max(0, finiteNumber(input.viewportCoverage));
    if (viewportCoverage >= 0.82 && input.hasCompactVisualChild === true
      && input.explicit !== true && input.bindingRoot !== true) {
      score -= 240_000;
    }
    if (directChildren <= 1 && input.hasCompactVisualChild === true
      && input.explicit !== true && input.bindingRoot !== true) {
      score -= 35_000;
    }
    if (input.uiLike === true && input.explicit !== true) score -= 900_000;
    return score;
  }

  function selectThemeRootCandidate(candidates = []) {
    let selected = null;
    let selectedScore = Number.NEGATIVE_INFINITY;
    for (const candidate of Array.isArray(candidates) ? candidates : []) {
      const score = scoreThemeRootCandidate(candidate);
      if (score > selectedScore) {
        selected = candidate;
        selectedScore = score;
      }
    }
    return selected;
  }

  const api = Object.freeze({ computeFit, scoreThemeRootCandidate, selectThemeRootCandidate });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.CFB27ThemeFit = api;
})(typeof window !== 'undefined' ? window : globalThis);
