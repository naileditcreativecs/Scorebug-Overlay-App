const logoSourceApi = typeof module !== 'undefined' && module.exports
  ? require('./logo-source')
  : globalThis.CFB27LogoSource;
const setLogoSourceIfChanged = logoSourceApi?.setLogoSourceIfChanged || ((image, source) => {
  if (!image || typeof image.getAttribute !== 'function') return false;
  const attribute = String(image.tagName || '').toUpperCase() === 'IMG' ? 'src' : 'href';
  const nextSource = typeof source === 'string' ? source.trim() : '';
  const currentSource = image.getAttribute(attribute);
  if (!nextSource) {
    if (currentSource === null) return false;
    image.removeAttribute(attribute);
    return true;
  }
  if (currentSource === nextSource) return false;
  image.setAttribute(attribute, nextSource);
  return true;
});

class ThemeBridge {
  constructor(frame, options = {}) {
    this.frame = frame;
    this.options = options;
    this.root = null;
    this.bindings = new Map();
    this.teamRows = new Map();
    this.observer = null;
    this.lastState = null;
    this.ready = false;
  }

  async attach(timeoutMs = 15000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const doc = this.frame.contentDocument;
      if (doc?.body) {
        const root = this.findRoot(doc);
        if (root) {
          this.root = root;
          this.normalizeDocument(doc, root);
          this.mapBindings(root);
          this.watch(root);
          this.ready = true;
          if (this.lastState) this.setState(this.lastState);
          return this.getMetrics();
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('No scorebug root was found in the selected HTML.');
  }

  findRoot(doc) {
    const explicit = doc.querySelector('[data-cfb27-scorebug], [data-cfb27-import-root]');
    if (explicit && this.isVisible(explicit)) return explicit;
    const candidates = [...doc.querySelectorAll('body *')].filter((element) => {
      if (!this.isVisible(element)) return false;
      const box = element.getBoundingClientRect();
      const direct = this.visibleChildren(element);
      if (box.width < 250 || box.width > 900 || box.height < 180 || box.height > 950) return false;
      if (direct.length < 4 || direct.length > 8) return false;
      const first = direct.slice(0, 4).map((child) => child.getBoundingClientRect().height);
      return first.length === 4 && Math.abs(first[0] - first[1]) < Math.max(14, first[0] * .18) && first[0] > first[2] * 1.35;
    });
    candidates.sort((a, b) => {
      const score = (el) => {
        const box = el.getBoundingClientRect();
        const count = this.visibleChildren(el).length;
        return (count === 4 ? 100 : 0) - Math.abs(box.width - 371) * .12 - Math.abs(box.height - 433) * .08;
      };
      return score(b) - score(a);
    });
    return candidates[0] || null;
  }

  isVisible(element) {
    if (!(element instanceof this.frame.contentWindow.Element)) return false;
    const box = element.getBoundingClientRect();
    const style = this.frame.contentWindow.getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  }

  visibleChildren(element) {
    return [...element.children].filter((child) => this.isVisible(child));
  }

  normalizeDocument(doc, root) {
    doc.documentElement.style.cssText += ';background:transparent!important;overflow:hidden!important;';
    doc.body.style.cssText += ';background:transparent!important;overflow:hidden!important;display:block!important;min-height:0!important;';
    const thumbnail = doc.getElementById('__bundler_thumbnail');
    const loading = doc.getElementById('__bundler_loading');
    if (thumbnail) thumbnail.style.display = 'none';
    if (loading) loading.style.display = 'none';
    root.setAttribute('data-cfb27-overlay-root', '');
    root.style.margin = '0';
    root.style.transformOrigin = 'top left';
    const style = doc.createElement('style');
    style.dataset.cfb27Overlay = 'true';
    style.textContent = `
      html,body{background:transparent!important;margin:0!important;padding:0!important;overflow:hidden!important}
      #__bundler_loading,#__bundler_thumbnail,#__bundler_err{display:none!important}
      [data-cfb27-overlay-root]{position:absolute!important;left:0!important;top:0!important}
    `;
    doc.head.appendChild(style);
  }

  mapBindings(root) {
    this.bindings.clear();
    this.teamRows.clear();
    root.querySelectorAll('[data-cfb27-bind], [data-cfb27-import-dynamic]').forEach((element) => {
      const name = element.getAttribute('data-cfb27-bind') || element.getAttribute('data-cfb27-import-dynamic');
      if (name) this.bindings.set(name, element);
    });
    const rows = this.visibleChildren(root);
    if (rows.length < 4) return;
    this.mapTeam(rows[0], 'away');
    this.mapTeam(rows[1], 'home');
    this.ensurePossessionBinding('away', 'home', rows[0]);
    this.ensurePossessionBinding('home', 'away', rows[1]);
    this.stabilizeScoreAndPossession('away');
    this.stabilizeScoreAndPossession('home');
    const info = this.visibleChildren(rows[2]);
    this.setBinding('game.quarter', info[0]);
    this.setBinding('game.clock', info[1]);
    this.setBinding('game.playClock', info[2]);
    const downTexts = this.textCandidates(rows[3]);
    this.setBinding('game.downDistance', downTexts[0]);
  }

  mapTeam(row, side) {
    row.dataset.cfb27TeamRow = side;
    this.teamRows.set(side, row);
    const direct = this.visibleChildren(row);
    const header = direct.find((candidate) => this.visibleChildren(candidate).filter((child) => child.textContent.trim()).length >= 3);
    const fields = header ? this.visibleChildren(header).filter((child) => child.textContent.trim()) : [];
    this.setBinding(`${side}.rank`, fields[0]);
    this.setBinding(`${side}.name`, fields[1]);
    this.setBinding(`${side}.record`, fields[2]);
    const timeoutContainer = direct.find((candidate) => this.visibleChildren(candidate).filter((child) => {
      const box = child.getBoundingClientRect(); return box.width >= 8 && box.height > 0 && box.height <= 20;
    }).length >= 3);
    this.setBinding(`${side}.timeouts`, timeoutContainer);
    const excluded = new Set([header, timeoutContainer]);
    const texts = this.textCandidates(row).filter((element) => ![...excluded].some((item) => item && (item === element || item.contains(element))));
    texts.sort((a, b) => parseFloat(getComputedStyle(b).fontSize) - parseFloat(getComputedStyle(a).fontSize));
    this.setBinding(`${side}.score`, texts[0]);
    const possession = [...row.querySelectorAll('*')].find((element) => {
      const style = getComputedStyle(element);
      return parseFloat(style.borderRightWidth || '0') >= 8 && parseFloat(style.borderTopWidth || '0') >= 6;
    });
    this.setBinding(`${side}.possession`, possession);
    const logo = row.querySelector('[data-cfb27-bind$=".logo"], [id*="logo" i], img');
    this.setBinding(`${side}.logo`, logo);
  }

  textCandidates(root) {
    return [...root.querySelectorAll('*')].filter((element) => this.isVisible(element) && element.children.length === 0 && element.textContent.trim());
  }

  setBinding(name, element) {
    if (!element || this.bindings.has(name)) return;
    element.setAttribute('data-cfb27-import-dynamic', name);
    this.bindings.set(name, element);
  }

  ensurePossessionBinding(side, otherSide, row) {
    if (this.bindings.get(`${side}.possession`)) return;
    const template = this.bindings.get(`${otherSide}.possession`);
    const score = this.bindings.get(`${side}.score`);
    if (!template || !score || !row) return;

    let container = score.parentElement;
    while (container && container !== row) {
      const display = this.frame.contentWindow.getComputedStyle(container).display;
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
    this.setBinding(`${side}.possession`, clone);
  }

  scoreDigitCount(value, score) {
    const displayed = value === undefined || value === null
      ? String(score?.textContent || '')
      : String(value);
    const digits = displayed.match(/\d/g);
    return Math.max(1, digits?.length || 0);
  }

  measureNaturalScoreWidth(score, scoreItem) {
    const nodes = [...new Set([scoreItem, score].filter(Boolean))];
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
  }

  stabilizeScoreAndPossession(side, liveScore) {
    const score = this.bindings.get(`${side}.score`);
    const possession = this.bindings.get(`${side}.possession`);
    if (!score || !possession) return;

    const digitCount = this.scoreDigitCount(liveScore, score);
    score.dataset.cfb27ScoreDigits = String(digitCount);

    const computedScore = this.frame.contentWindow.getComputedStyle(score);
    const computedPossession = this.frame.contentWindow.getComputedStyle(possession);
    if (computedScore.position === 'absolute' || computedPossession.position === 'absolute') {
      score.style.setProperty('white-space', 'nowrap', 'important');
      score.style.setProperty('font-variant-numeric', 'tabular-nums', 'important');
      if (!possession.dataset.cfb27AuthoredLeft) {
        possession.dataset.cfb27AuthoredLeft = computedPossession.left;
        possession.dataset.cfb27AuthoredRight = computedPossession.right;
        possession.dataset.cfb27AuthoredTransform = computedPossession.transform;
        const firstScoreRect = score.getBoundingClientRect();
        const firstPossessionRect = possession.getBoundingClientRect();
        possession.dataset.cfb27ArrowDirection = firstPossessionRect.left >= firstScoreRect.left ? '1' : '-1';
      }
      possession.style.setProperty('left', possession.dataset.cfb27AuthoredLeft, 'important');
      possession.style.setProperty('right', possession.dataset.cfb27AuthoredRight, 'important');
      const naturalScoreWidth = this.measureNaturalScoreWidth(score, score);
      const protectedScoreWidth = Math.max(1, Math.ceil(naturalScoreWidth * 1.12 + 2));
      const referenceWidth = Number(possession.dataset.cfb27ReferenceScoreWidth);
      if (!Number.isFinite(referenceWidth) || referenceWidth <= 0) {
        possession.dataset.cfb27ReferenceScoreWidth = String(protectedScoreWidth);
      }
      const authoredTransform = possession.dataset.cfb27AuthoredTransform;
      const direction = Number(possession.dataset.cfb27ArrowDirection) < 0 ? -1 : 1;
      const baseWidth = Number(possession.dataset.cfb27ReferenceScoreWidth) || protectedScoreWidth;
      let arrowShift = direction * (protectedScoreWidth - baseWidth);
      const baseTransform = authoredTransform && authoredTransform !== 'none' ? ` ${authoredTransform}` : '';
      possession.style.setProperty('transform', `translateX(${arrowShift}px)${baseTransform}`, 'important');

      const scoreRect = score.getBoundingClientRect();
      const possessionRect = possession.getBoundingClientRect();
      if (direction > 0 && possessionRect.left < scoreRect.right + 8) {
        arrowShift += scoreRect.right + 8 - possessionRect.left;
      } else if (direction < 0 && possessionRect.right > scoreRect.left - 8) {
        arrowShift -= possessionRect.right - (scoreRect.left - 8);
      }
      possession.style.setProperty('transform', `translateX(${arrowShift}px)${baseTransform}`, 'important');
      possession.dataset.cfb27ScoreDigits = String(digitCount);
      possession.dataset.cfb27ArrowShift = String(arrowShift);
      return;
    }

    let scoreGroup = score.parentElement;
    while (scoreGroup && !scoreGroup.contains(possession)) scoreGroup = scoreGroup.parentElement;
    if (!scoreGroup) return;

    let scoreItem = score;
    while (scoreItem.parentElement && scoreItem.parentElement !== scoreGroup) {
      scoreItem = scoreItem.parentElement;
    }

    if (scoreItem === score) {
      const lane = this.frame.contentDocument.createElement('span');
      lane.dataset.cfb27ScoreLane = side;
      scoreGroup.insertBefore(lane, score);
      lane.appendChild(score);
      scoreItem = lane;
    } else {
      scoreItem.dataset.cfb27ScoreLane = side;
    }

    let column = possession.closest('[data-cfb27-possession-column]');
    if (!column || column.parentElement !== scoreGroup) {
      column = this.frame.contentDocument.createElement('span');
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
    const naturalScoreWidth = this.measureNaturalScoreWidth(score, scoreItem);
    const currentProtectedWidth = Math.max(1, Math.ceil(naturalScoreWidth * 1.12 + 2));
    const cachedProtectedWidth = Number(scoreItem.dataset.cfb27ProtectedScoreWidth);
    const initialLaneWidth = digitCount === 1
      ? Math.max(currentProtectedWidth, Math.ceil(naturalScoreWidth * 2 * 1.12 + 2))
      : currentProtectedWidth;
    const protectedLaneWidth = Number.isFinite(cachedProtectedWidth) && cachedProtectedWidth > 0
      ? Math.max(cachedProtectedWidth, currentProtectedWidth)
      : initialLaneWidth;
    const arrowShift = currentProtectedWidth - protectedLaneWidth;
    scoreItem.dataset.cfb27ProtectedScoreWidth = String(protectedLaneWidth);
    scoreItem.dataset.cfb27CurrentScoreWidth = String(currentProtectedWidth);
    scoreItem.dataset.cfb27ScoreDigits = String(digitCount);
    scoreItem.style.setProperty('width', `${protectedLaneWidth}px`, 'important');
    scoreItem.style.setProperty('min-width', `${protectedLaneWidth}px`, 'important');
    scoreItem.style.setProperty('flex-basis', `${protectedLaneWidth}px`, 'important');
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
    column.style.setProperty('transform', `translateX(${arrowShift}px)`, 'important');
    column.style.setProperty('transform-origin', 'left center', 'important');
    column.dataset.cfb27ScoreDigits = String(digitCount);
    column.dataset.cfb27ArrowShift = String(arrowShift);
    possession.style.setProperty('flex', '0 0 auto', 'important');
    possession.style.setProperty('margin', '0', 'important');
    possession.style.setProperty('align-self', 'center', 'important');
  }

  watch(root) {
    this.observer?.disconnect();
    this.observer = new this.frame.contentWindow.MutationObserver(() => {
      const missingBinding = [...this.bindings.values()].some((element) => !element?.isConnected);
      if (!root.isConnected || missingBinding) {
        this.ready = false;
        this.attach().catch(() => {});
      }
    });
    this.observer.observe(root.ownerDocument.body, { childList: true, subtree: true });
  }

  getMetrics() {
    if (!this.root) return null;
    const box = this.root.getBoundingClientRect();
    return { width: Math.ceil(box.width), height: Math.ceil(box.height), bindings: [...this.bindings.keys()] };
  }

  setState(state) {
    this.lastState = state;
    if (!this.ready) return;
    const text = {
      'away.rank': state.away?.rank ? String(state.away.rank) : '',
      'away.name': state.away?.shortName || state.away?.name || '',
      'away.nickname': state.away?.nickname || '',
      'away.mascot': state.away?.nickname || '',
      'away.record': state.away?.record || '',
      'away.score': String(state.away?.score ?? ''),
      'home.rank': state.home?.rank ? String(state.home.rank) : '',
      'home.name': state.home?.shortName || state.home?.name || '',
      'home.nickname': state.home?.nickname || '',
      'home.mascot': state.home?.nickname || '',
      'home.record': state.home?.record || '',
      'home.score': String(state.home?.score ?? ''),
      'game.quarter': state.game?.quarter || '',
      'game.clock': state.game?.clock || '',
      'game.playClock': state.game?.playClock ?? '',
      'game.downDistance': state.game?.downDistance || ''
    };
    for (const [name, value] of Object.entries(text)) {
      const element = this.bindings.get(name);
      if (element) element.textContent = value;
    }
    // Any other binding is a state path (away.confRecord, game.weekLabel,
    // away.leaders.qbLine, game.penalty.text ...).
    for (const [name, element] of this.bindings) {
      if (name in text || /\.(logo|timeouts|possession)$/.test(name)) continue;
      const value = name.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), state);
      if (value === undefined) continue;
      element.textContent = value === null || typeof value === 'object' ? '' : String(value);
    }
    this.updateTimeouts('away', state.away?.timeouts);
    this.updateTimeouts('home', state.home?.timeouts);
    this.updatePossession('away', Boolean(state.away?.possession));
    this.updatePossession('home', Boolean(state.home?.possession));
    this.stabilizeScoreAndPossession('away', state.away?.score);
    this.stabilizeScoreAndPossession('home', state.home?.score);
    this.updateTeamColor('away', state.away?.color);
    this.updateTeamColor('home', state.home?.color);
    this.updateLogo('away', state.away?.logo, state.meta?.teamLogoLayouts?.away);
    this.updateLogo('home', state.home?.logo, state.meta?.teamLogoLayouts?.home);
    // An empty record means "show no record": also hide any record-looking
    // element the binding pass doesn't own (baked-in demo text like "2-0").
    for (const side of ['away', 'home']) {
      const record = state?.[side]?.record;
      const hidden = record === null || record === undefined || String(record).trim() === '';
      const matched = new Set();
      const bound = this.bindings.get(`${side}.record`);
      if (bound) matched.add(bound);
      this.root?.querySelectorAll('[id*="record" i],[class*="record" i]').forEach((element) => {
        const className = typeof element.className === 'string'
          ? element.className : String(element.className?.baseVal || '');
        if (`${element.id} ${className}`.toLowerCase().includes(side)) matched.add(element);
      });
      matched.forEach((element) => {
        if (hidden) element.style.setProperty('visibility', 'hidden', 'important');
        else element.style.removeProperty('visibility');
      });
    }
  }

  updateTimeouts(side, count) {
    const container = this.bindings.get(`${side}.timeouts`);
    if (!container) return;
    const hasValue = count !== null && count !== undefined && Number.isFinite(Number(count));
    container.style.visibility = hasValue ? 'visible' : 'hidden';
    if (!hasValue) return;
    const bars = this.visibleChildren(container);
    const indicators = bars.length ? bars : [...container.children];
    const remaining = Math.max(0, Math.min(indicators.length, Number(count) || 0));
    const firstRemaining = indicators.length - remaining;
    indicators.forEach((bar, index) => {
      bar.style.opacity = index >= firstRemaining ? '1' : '.18';
    });
  }

  updatePossession(side, active) {
    const element = this.bindings.get(`${side}.possession`);
    if (element) {
      element.style.setProperty('visibility', active ? 'visible' : 'hidden', 'important');
      element.style.setProperty('opacity', active ? '1' : '0', 'important');
    }
  }

  updateTeamColor(side, value) {
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) return;
    const row = this.teamRows.get(side);
    if (!row) return;
    const channels = [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
    const shade = (amount) => `rgb(${channels.map((channel) => Math.max(0, Math.min(255, Math.round(
      amount >= 0 ? channel + ((255 - channel) * amount) : channel * (1 + amount),
    )))).join(', ')})`;
    row.style.setProperty(
      'background',
      `linear-gradient(165deg, ${shade(0.16)} 0%, ${value} 48%, ${shade(-0.2)} 100%)`,
      'important',
    );
  }

  updateLogo(side, source, transform) {
    const element = this.bindings.get(`${side}.logo`);
    if (!element) return;
    const hasLogo = typeof source === 'string' && source.trim().length > 0;
    const image = element.matches('img, image') ? element : element.querySelector?.('img, image');
    if (image) {
      this.enlargeLiveLogo(image, transform);
      element.style.visibility = hasLogo ? 'visible' : 'hidden';
      setLogoSourceIfChanged(image, source);
      return;
    }

    if (element.tagName.includes('-') && element.parentElement) {
      const host = element.parentElement;
      const computed = this.frame.contentWindow.getComputedStyle(host);
      if (computed.position === 'static') host.style.setProperty('position', 'relative', 'important');
      let liveImage = host.querySelector(`:scope > img[data-cfb27-live-logo="${side}"]`);
      if (!liveImage) {
        liveImage = element.ownerDocument.createElement('img');
        liveImage.dataset.cfb27LiveLogo = side;
        liveImage.alt = '';
        liveImage.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:center;z-index:20;pointer-events:none;';
        host.appendChild(liveImage);
      }
      this.enlargeLiveLogo(liveImage, transform);
      element.style.setProperty('visibility', 'hidden', 'important');
      liveImage.style.display = hasLogo ? 'block' : 'none';
      setLogoSourceIfChanged(liveImage, source);
      return;
    }

    const computed = this.frame.contentWindow.getComputedStyle(element);
    if (computed.position === 'static') element.style.setProperty('position', 'relative', 'important');
    let liveImage = element.querySelector(`:scope > img[data-cfb27-live-logo="${side}"]`);
    if (!liveImage) {
      liveImage = element.ownerDocument.createElement('img');
      liveImage.dataset.cfb27LiveLogo = side;
      liveImage.alt = '';
      liveImage.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:center;z-index:20;pointer-events:none;';
      element.appendChild(liveImage);
    }
    this.enlargeLiveLogo(liveImage, transform);
    element.style.visibility = hasLogo ? 'visible' : 'hidden';
    element.style.setProperty('color', 'transparent', 'important');
    element.style.setProperty('border-color', 'transparent', 'important');
    liveImage.style.display = hasLogo ? 'block' : 'none';
    setLogoSourceIfChanged(liveImage, source);
  }

  enlargeLiveLogo(image, transform = {}) {
    if (!image) return;
    if (!image.dataset.cfb27LogoBaseWidth) {
      image.dataset.cfb27LogoBaseWidth = String(image.offsetWidth || 0);
      image.dataset.cfb27LogoBaseHeight = String(image.offsetHeight || 0);
    }
    const finite = (candidate, fallback) => Number.isFinite(Number(candidate)) ? Number(candidate) : fallback;
    const x = Math.max(-2000, Math.min(2000, finite(transform?.x, 0)));
    const y = Math.max(-2000, Math.min(2000, finite(transform?.y, 0)));
    const scale = Math.max(0.1, Math.min(5, finite(transform?.scale, 1.13)));
    const rotation = Math.max(-180, Math.min(180, finite(transform?.rotation, 0)));
    image.dataset.cfb27LogoScale = String(scale);
    image.dataset.cfb27LogoX = String(x);
    image.dataset.cfb27LogoY = String(y);
    image.dataset.cfb27LogoRotation = String(rotation);
    image.style.setProperty('transform', `translate(${x}px, ${y}px) rotate(${rotation}deg) scale(${scale})`, 'important');
    image.style.setProperty('transform-origin', 'center', 'important');
    image.style.setProperty('object-position', 'center center', 'important');
    image.style.setProperty('image-rendering', 'auto', 'important');
  }

  destroy() {
    this.observer?.disconnect();
    this.observer = null;
    this.ready = false;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ThemeBridge, setLogoSourceIfChanged };
} else {
  window.ThemeBridge = ThemeBridge;
}
