'use strict';

const api = window.diagnosis;
const findingsEl = document.getElementById('findings');
const allclearEl = document.getElementById('allclear');
const headlineEl = document.getElementById('headline');
const sublineEl = document.getElementById('subline');
const pillEl = document.getElementById('level-pill');
const alwaysShow = document.getElementById('always-show');

const PILL_TEXT = { bad: 'WILL NOT READ', warn: 'NEEDS ATTENTION', info: 'HEADS-UP', ok: 'ALL CLEAR' };
const HEADLINES = {
  bad: 'The game will not be read until this is fixed',
  warn: 'Something needs attention',
  info: 'A heads-up before you start',
  ok: 'Ready to read the game',
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function render(report) {
  if (!report) return;
  const level = report.level || 'ok';
  pillEl.className = `pill ${level}`;
  pillEl.textContent = PILL_TEXT[level] || level.toUpperCase();
  headlineEl.textContent = HEADLINES[level] || HEADLINES.ok;
  sublineEl.textContent = report.findings.length
    ? `${report.findings.length} thing${report.findings.length === 1 ? '' : 's'} found. Each one says what it is, why it stops reading, and how to fix it. Fix it, then press Re-check.`
    : 'Nothing found that would stop the reader.';
  findingsEl.replaceChildren();
  for (const f of report.findings) {
    const card = el('article', `finding ${f.severity}`);
    card.append(el('h2', null, f.title));
    card.append(el('p', 'why', f.why));
    card.append(el('p', 'fix-label', 'HOW TO FIX'));
    const list = el('ol');
    for (const step of f.fix) list.append(el('li', null, step));
    card.append(list);
    if (f.detail) card.append(el('p', 'detail', f.detail));
    findingsEl.append(card);
  }
  allclearEl.classList.toggle('hidden', report.findings.length > 0);
  if (typeof report.alwaysShow === 'boolean') alwaysShow.checked = report.alwaysShow;
}

async function recheck() {
  document.getElementById('btn-recheck').textContent = 'Checking…';
  try {
    render(await api.recheck());
  } finally {
    document.getElementById('btn-recheck').textContent = 'Re-check';
  }
}

document.getElementById('btn-recheck').addEventListener('click', recheck);
document.getElementById('btn-copy').addEventListener('click', async () => {
  await api.copyReport();
  const button = document.getElementById('btn-copy');
  button.textContent = 'Copied';
  setTimeout(() => { button.textContent = 'Copy report'; }, 1400);
});
document.getElementById('btn-close').addEventListener('click', () => api.close());
alwaysShow.addEventListener('change', () => api.setAlwaysShow(alwaysShow.checked));
api.onReport(render);
api.getReport().then(render).catch(() => {});
