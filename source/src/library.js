'use strict';

(function () {
  const ORIGINAL_ESPN_2013_SHA256 = 'BDCF89E766BD98EFF75DEFDFC8E6FBAD2905B09CBEEE886C90B5AC9950A279F2';
  const api = window.scoreboard;
  const observers = [];
  const $ = (id) => document.getElementById(id);

  function fitPreview(shell, iframe, dimensions = {}) {
    const width = Math.max(160, Math.min(5000, Number(dimensions.width) || 1200));
    const height = Math.max(90, Math.min(3000, Number(dimensions.height) || 800));
    iframe.style.width = `${width}px`;
    iframe.style.height = `${height}px`;
    const fit = () => {
      if (!shell.clientWidth || !shell.clientHeight) return;
      const scale = Math.min(shell.clientWidth / width, shell.clientHeight / height);
      iframe.style.left = `${Math.round((shell.clientWidth - width * scale) / 2)}px`;
      iframe.style.top = `${Math.round((shell.clientHeight - height * scale) / 2)}px`;
      iframe.style.transform = `scale(${scale})`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(shell);
    observers.push(observer);
    requestAnimationFrame(fit);
  }

  function compatibilityTag(theme, original) {
    if (original) return { text: 'Original verified', className: 'tag' };
    if (theme.compatibility?.canUse === false) return { text: 'Project HTML', className: 'tag bad' };
    if (theme.compatibility?.level === 'ready') return { text: 'Live-data ready', className: 'tag' };
    return { text: 'Standalone HTML', className: 'tag warn' };
  }

  function render(themes) {
    observers.splice(0).forEach((observer) => observer.disconnect());
    const grid = $('theme-grid');
    grid.replaceChildren();
    $('theme-count').textContent = String(themes.length);
    $('library-message').textContent = `${themes.length} saved scoreboard${themes.length === 1 ? '' : 's'}`;

    const original = themes.find((theme) => theme.sha256 === ORIGINAL_ESPN_2013_SHA256);
    const originalStatus = $('original-status');
    originalStatus.className = `original-status ${original ? '' : 'missing'}`.trim();
    originalStatus.querySelector('span').textContent = original
      ? 'Verified: the saved library copy exactly matches the bundled Football Scorebug ESPN 2013 file.'
      : 'The exact original ESPN 2013 file is not currently in the library.';

    if (!themes.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No scoreboards are saved yet. Choose Import Standalone HTML.';
      grid.appendChild(empty);
      return;
    }

    for (const theme of themes) {
      const isOriginal = theme.sha256 === ORIGINAL_ESPN_2013_SHA256;
      const blocked = theme.compatibility?.canUse === false;
      const card = document.createElement('article');
      card.className = `theme-card${isOriginal ? ' original' : ''}${blocked ? ' blocked' : ''}`;

      const preview = document.createElement('div');
      preview.className = 'preview';
      const frame = document.createElement('iframe');
      frame.title = `Preview of ${theme.name}`;
      frame.loading = 'eager';
      frame.referrerPolicy = 'no-referrer';
      frame.setAttribute('sandbox', '');
      if (theme.previewHtml) frame.srcdoc = theme.previewHtml;
      else frame.src = theme.previewUrl;
      preview.appendChild(frame);
      fitPreview(preview, frame, theme.compatibility?.preview);

      const info = document.createElement('div');
      info.className = 'theme-info';
      const titleLine = document.createElement('div');
      titleLine.className = 'theme-title-line';
      const title = document.createElement('strong');
      title.textContent = theme.name || theme.fileName || 'Imported scoreboard';
      title.title = title.textContent;
      const tagInfo = compatibilityTag(theme, isOriginal);
      const tag = document.createElement('span');
      tag.className = tagInfo.className;
      tag.textContent = tagInfo.text;
      titleLine.append(title, tag);
      const file = document.createElement('small');
      file.className = 'file';
      file.textContent = theme.fileName || 'HTML file';
      const compatibility = document.createElement('p');
      compatibility.className = 'compatibility';
      compatibility.textContent = isOriginal
        ? 'Exact original ESPN 2013 HTML; automatic live-field mapping is already supported.'
        : (theme.compatibility?.detail || 'The app will attempt automatic live-field matching.');
      const use = document.createElement('button');
      use.className = theme.active ? '' : 'primary';
      use.textContent = theme.active ? 'Currently in use' : (blocked ? 'Needs Claude Standalone HTML' : 'Use this theme');
      use.disabled = Boolean(theme.active || blocked);
      use.addEventListener('click', async () => {
        try {
          $('library-message').textContent = `Selecting ${theme.name}…`;
          const result = await api.useLibraryTheme(theme.id);
          render(result?.themes || await api.listThemeLibrary());
        } catch (error) {
          $('library-message').textContent = `Could not select theme: ${error.message}`;
        }
      });
      info.append(titleLine, file, compatibility, use);
      card.append(preview, info);
      grid.appendChild(card);
    }
  }

  async function refresh() {
    try {
      $('library-message').textContent = 'Loading saved scoreboards…';
      render(await api.listThemeLibrary());
    } catch (error) {
      $('library-message').textContent = `Library failed to load: ${error.message}`;
    }
  }

  $('refresh-library').addEventListener('click', refresh);
  $('import-theme').addEventListener('click', async () => {
    try {
      const result = await api.importThemeToLibrary();
      if (!result?.canceled) render(result.themes || await api.listThemeLibrary());
    } catch (error) {
      $('library-message').textContent = error.message;
    }
  });
  $('close-library').addEventListener('click', () => window.close());
  refresh();
})();
