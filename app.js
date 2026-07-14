
const DEFAULT_SETTINGS = {
  rate: 0.85,
  voiceName: null,
  autoplay: true,
  shuffle: true,
  autoAdvance: false,
  autoAdvanceSeconds: 5
};

let sentences = [];
let settings = { ...DEFAULT_SETTINGS };
let queue = [];
let queuePos = 0;
let dictQueue = [];
let dictPos = 0;
let dictChecked = false;
let currentTab = 'study';
let autoAdvanceTimer = null;
let pendingDeleteId = null;
let pendingAction = null;
let pendingEditId = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ---------------- storage helpers ---------------- */

async function loadAll() {
  try {
    const raw = localStorage.getItem('sentences');
    if (raw === null) throw new Error('no stored sentences');
    sentences = JSON.parse(raw);
    if (!Array.isArray(sentences)) throw new Error('invalid sentences data');
  } catch (e) {
    const seed = (typeof SEED_SENTENCES !== 'undefined') ? SEED_SENTENCES : [];
    sentences = JSON.parse(JSON.stringify(seed));
    await saveSentences();
  }
  try {
    const raw = localStorage.getItem('settings');
    if (raw === null) throw new Error('no stored settings');
    settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch (e) {
    settings = { ...DEFAULT_SETTINGS };
    await saveSettings();
  }
}

async function saveSentences() {
  try {
    localStorage.setItem('sentences', JSON.stringify(sentences));
  } catch (e) {
    console.error('save sentences failed', e);
  }
}

async function saveSettings() {
  try {
    localStorage.setItem('settings', JSON.stringify(settings));
  } catch (e) {
    console.error('save settings failed', e);
  }
}

/* ---------------- text helpers ---------------- */

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function toDisplayHtml(raw) {
  const esc = escapeHtml(raw);
  return esc.replace(/\*\*(.+?)\*\*/g, '<mark>$1</mark>');
}

function toPlainText(raw) {
  return raw.replace(/\*\*(.+?)\*\*/g, '$1');
}

function unescapeHtml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function htmlToRaw(html) {
  const withStars = html.replace(/<mark>(.+?)<\/mark>/g, '**$1**');
  return unescapeHtml(withStars);
}

function makeId() {
  return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function showToast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._hideTimer);
  t._hideTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

/* ---------------- queue / study logic ---------------- */

function levelMeta(box) {
  if (box <= 1) return { label: '새 문장', color: 'coral' };
  if (box === 2) return { label: '연습 중', color: 'amber' };
  if (box === 3) return { label: '익숙해짐', color: 'teal' };
  return { label: '마스터', color: 'teal' };
}

function buildWeightedPool() {
  const pool = [];
  sentences.forEach((s, idx) => {
    const weight = Math.max(1, 5 - (s.box || 1));
    for (let i = 0; i < weight; i++) pool.push(idx);
  });
  if (settings.shuffle) {
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
  } else {
    pool.sort((a, b) => a - b);
  }
  return pool;
}

function buildQueue() {
  if (sentences.length === 0) {
    queue = [];
    queuePos = 0;
    return;
  }
  queue = buildWeightedPool();
  queuePos = 0;
}

function buildDictQueue() {
  if (sentences.length === 0) {
    dictQueue = [];
    dictPos = 0;
    return;
  }
  dictQueue = buildWeightedPool();
  dictPos = 0;
}

function currentSentence() {
  if (queue.length === 0) return null;
  const idx = queue[queuePos];
  return sentences[idx];
}

function renderStudyCard() {
  clearAutoAdvance();
  const s = currentSentence();
  const textEl = $('#sentenceText');
  const koEl = $('#sentenceKo');
  const chip = $('#levelChip');
  const counter = $('#cardCounter');

  if (!s) {
    textEl.innerHTML = '아직 문장이 없어요. 오른쪽 아래 + 버튼으로 문장을 추가해보세요.';
    koEl.textContent = '';
    chip.style.display = 'none';
    counter.textContent = '0 / 0';
    return;
  }

  chip.style.display = 'inline-block';
  textEl.innerHTML = s.html;
  koEl.textContent = s.ko || '';
  const meta = levelMeta(s.box);
  chip.textContent = meta.label;
  chip.style.background = `var(--${meta.color}-soft)`;
  chip.style.color = `var(--${meta.color})`;
  counter.textContent = `${queuePos + 1} / ${queue.length}`;

  updateProgressHeader();

  if (settings.autoplay) {
    speak(s.text);
  }
  if (settings.autoAdvance) {
    autoAdvanceTimer = setTimeout(() => {
      goNext();
    }, Math.max(2, settings.autoAdvanceSeconds) * 1000);
  }
}

function clearAutoAdvance() {
  if (autoAdvanceTimer) {
    clearTimeout(autoAdvanceTimer);
    autoAdvanceTimer = null;
  }
}

function goNext() {
  if (queue.length === 0) return;
  queuePos++;
  if (queuePos >= queue.length) {
    buildQueue();
  }
  renderStudyCard();
}

function goPrev() {
  if (queue.length === 0) return;
  queuePos--;
  if (queuePos < 0) queuePos = Math.max(0, queue.length - 1);
  renderStudyCard();
}

async function markSentence(result) {
  const s = currentSentence();
  if (!s) return;
  s.reviews = (s.reviews || 0) + 1;
  if (result === 'know') {
    s.box = Math.min(4, (s.box || 1) + 1);
  } else {
    s.box = 1;
  }
  await saveSentences();
  goNext();
}

function updateProgressHeader() {
  const total = sentences.length;
  const mastered = sentences.filter(s => (s.box || 1) >= 4).length;
  $('#masteredCount').textContent = `${mastered} / ${total} 마스터`;
  $('#progressFill').style.width = total ? `${(mastered / total) * 100}%` : '0%';
}

/* ---------------- dictation mode ---------------- */

function currentDictSentence() {
  if (dictQueue.length === 0) return null;
  const idx = dictQueue[dictPos];
  return sentences[idx];
}

function tokenizeForDiff(str) {
  return str
    .toLowerCase()
    .replace(/[.,!?;:"“”‘’]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function lcsMatch(correctWords, userWords) {
  const n = correctWords.length;
  const m = userWords.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (correctWords[i - 1] === userWords[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const matched = new Array(n).fill(false);
  let i = n, j = m;
  while (i > 0 && j > 0) {
    if (correctWords[i - 1] === userWords[j - 1]) {
      matched[i - 1] = true; i--; j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  return { matched, score: dp[n][m] };
}

function renderDictationCard() {
  const s = currentDictSentence();
  const counter = $('#dictCounter');
  const input = $('#dictInput');
  dictChecked = false;
  $('#dictResult').classList.remove('show');
  $('#dictActionsCheck').style.display = 'flex';
  $('#dictActionsNext').style.display = 'none';
  input.value = '';
  input.disabled = false;

  if (!s) {
    counter.textContent = '0 / 0';
    input.placeholder = '아직 문장이 없어요. 학습 탭에서 먼저 문장을 추가해보세요.';
    return;
  }

  counter.textContent = `${dictPos + 1} / ${dictQueue.length}`;
  input.placeholder = '여기에 입력하세요...';
  speak(s.text);
  input.focus();
}

function replayDictation() {
  const s = currentDictSentence();
  if (s) speak(s.text);
}

async function checkDictation() {
  const s = currentDictSentence();
  if (!s || dictChecked) return;
  dictChecked = true;

  const correctWords = tokenizeForDiff(s.text);
  const userWords = tokenizeForDiff($('#dictInput').value);
  const { matched, score } = lcsMatch(correctWords, userWords);
  const accuracy = correctWords.length ? Math.round((score / correctWords.length) * 100) : 0;

  const displayWords = s.text.split(/\s+/);
  const html = displayWords.map((w, i) => {
    const ok = matched[i];
    return `<span class="${ok ? 'ok' : 'miss'}">${escapeHtml(w)}</span>`;
  }).join(' ');

  $('#dictCorrectSentence').innerHTML = html;
  $('#dictKoHint').textContent = s.ko || '';

  const accEl = $('#dictAccuracy');
  accEl.textContent = `정확도 ${accuracy}%`;
  accEl.className = 'dict-accuracy ' + (accuracy >= 85 ? 'good' : accuracy >= 50 ? 'mid' : 'bad');

  $('#dictResult').classList.add('show');
  $('#dictActionsCheck').style.display = 'none';
  $('#dictActionsNext').style.display = 'flex';
  $('#dictInput').disabled = true;

  s.reviews = (s.reviews || 0) + 1;
  s.box = accuracy >= 85 ? Math.min(4, (s.box || 1) + 1) : 1;
  await saveSentences();
  updateProgressHeader();
}

function retryDictation() {
  dictChecked = false;
  $('#dictResult').classList.remove('show');
  $('#dictActionsCheck').style.display = 'flex';
  $('#dictActionsNext').style.display = 'none';
  const input = $('#dictInput');
  input.disabled = false;
  input.value = '';
  input.focus();
  replayDictation();
}

function nextDictation() {
  dictPos++;
  if (dictPos >= dictQueue.length) {
    buildDictQueue();
  }
  renderDictationCard();
}

/* ---------------- translation ---------------- */

async function translateToKorean(text) {
  try {
    const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|ko`);
    if (!res.ok) return '';
    const data = await res.json();
    const translated = data && data.responseData && data.responseData.translatedText;
    if (!translated) return '';
    // MyMemory sometimes echoes the source text back when it fails to translate
    if (translated.trim().toLowerCase() === text.trim().toLowerCase()) return '';
    return translated;
  } catch (e) {
    console.error('translate failed', e);
    return '';
  }
}

/* ---------------- OCR (사진에서 문장 가져오기) ---------------- */

const OCR_NOISE_PATTERNS = [
  /^\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}$/,   // 2026.06.19 같은 날짜
  /^(PT|MATE|EN|KO|영어|한국어|저장한\s?문장)$/i,
  /^[A-Z]{1,4}$/,                          // PT, MATE 같은 짧은 탭 라벨
  /^[0-9:apm\s]+$/i                        // 시계, 배터리 표시 등
];

function isOcrNoiseLine(line) {
  if (line.length < 3) return true;
  if (OCR_NOISE_PATTERNS.some((re) => re.test(line))) return true;
  const labelWord = /^(PT|MATE|EN|KO|영어|한국어)$/i;
  const words = line.split(/\s+/).filter(Boolean);
  if (words.length > 0 && words.every((w) => labelWord.test(w))) return true;
  return false;
}

function looksLikeSentence(line) {
  const letters = (line.match(/[A-Za-z]/g) || []).length;
  const words = line.trim().split(/\s+/).filter(Boolean).length;
  return letters >= 4 && words >= 2;
}

function cleanOcrText(rawText) {
  const rawLines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
  const sentences = [];
  let buffer = '';

  for (const line of rawLines) {
    if (isOcrNoiseLine(line)) continue;
    buffer = buffer ? `${buffer} ${line}` : line;
    if (/[.!?]["')]?$/.test(buffer)) {
      if (looksLikeSentence(buffer)) sentences.push(buffer.trim());
      buffer = '';
    }
  }
  if (buffer && looksLikeSentence(buffer)) sentences.push(buffer.trim());

  return sentences.join('\n');
}

async function runOcrOnFile(file) {
  const btn = $('#ocrImportBtn');
  const label = $('#ocrBtnLabel');
  btn.classList.add('loading');
  const originalLabel = label.textContent;
  label.innerHTML = '';
  const spinner = document.createElement('span');
  spinner.className = 'spinner';
  label.appendChild(spinner);
  label.appendChild(document.createTextNode(' 문장을 인식하고 있어요...'));

  try {
    // Tesseract를 처음 사용할 때만 동적으로 불러옴 (앱 시작 속도에 영향 없음)
    if (typeof Tesseract === 'undefined') {
      label.lastChild.textContent = ' 인식 엔진 불러오는 중...';
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
      label.lastChild.textContent = ' 문장을 인식하고 있어요...';
    }
    const { data } = await Tesseract.recognize(file, 'eng');
    const cleaned = cleanOcrText(data.text || '');
    if (!cleaned) {
      showToast('문장을 찾지 못했어요. 더 선명한 사진으로 다시 시도해보세요.');
    } else {
      const existing = $('#addTextarea').value.trim();
      $('#addTextarea').value = existing ? `${existing}\n${cleaned}` : cleaned;
      showToast('인식 완료! 내용을 확인하고 수정한 후 추가해주세요.');
    }
  } catch (e) {
    console.error('OCR failed', e);
    showToast('인식에 실패했어요. 다시 시도해주세요.');
  } finally {
    btn.classList.remove('loading');
    label.textContent = originalLabel;
  }
}

/* ---------------- speech ---------------- */


let availableVoices = [];

function refreshVoices() {
  availableVoices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  const select = $('#voiceSelect');
  if (!select) return;
  const prevValue = settings.voiceName || '';
  select.innerHTML = '';
  const englishVoices = availableVoices.filter(v => v.lang && v.lang.toLowerCase().startsWith('en'));
  const otherVoices = availableVoices.filter(v => !(v.lang && v.lang.toLowerCase().startsWith('en')));
  const ordered = englishVoices.concat(otherVoices);

  const autoOpt = document.createElement('option');
  autoOpt.value = '';
  autoOpt.textContent = '자동 (기본 영어 음성)';
  select.appendChild(autoOpt);

  ordered.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.name;
    opt.textContent = `${v.name} (${v.lang})`;
    select.appendChild(opt);
  });
  select.value = prevValue && ordered.some(v => v.name === prevValue) ? prevValue : '';
}

function pickVoice() {
  if (settings.voiceName) {
    const found = availableVoices.find(v => v.name === settings.voiceName);
    if (found) return found;
  }
  return availableVoices.find(v => v.lang && v.lang.toLowerCase().startsWith('en-us'))
    || availableVoices.find(v => v.lang && v.lang.toLowerCase().startsWith('en'))
    || null;
}

function speak(text) {
  if (!window.speechSynthesis) {
    showToast('이 브라우저는 음성 읽기를 지원하지 않아요.');
    return;
  }
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'en-US';
  utter.rate = settings.rate || 0.85;
  const voice = pickVoice();
  if (voice) utter.voice = voice;

  const btn = $('#speakBtn');
  btn.classList.add('playing');
  utter.onend = () => btn.classList.remove('playing');
  utter.onerror = () => btn.classList.remove('playing');
  window.speechSynthesis.speak(utter);
}

/* ---------------- list view ---------------- */

function renderList(filterText) {
  const listEl = $('#sentenceList');
  const q = (filterText || '').trim().toLowerCase();
  const filtered = sentences
    .map((s, idx) => ({ ...s, idx }))
    .filter(s => !q || s.text.toLowerCase().includes(q));

  $('#statTotal').textContent = sentences.length;
  $('#statPracticing').textContent = sentences.filter(s => (s.box || 1) <= 2).length;
  $('#statMastered').textContent = sentences.filter(s => (s.box || 1) >= 4).length;

  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="empty-state">${sentences.length === 0 ? '아직 추가한 문장이 없어요.' : '검색 결과가 없어요.'}</div>`;
    return;
  }

  listEl.innerHTML = filtered.map(s => {
    const meta = levelMeta(s.box);
    return `
      <div class="sent-row" data-id="${s.id}">
        <div class="row-top">
          <div class="lvl-dot" style="background:var(--${meta.color})"></div>
          <div style="flex:1;">
            <div class="row-text">${s.html}</div>
            ${s.ko ? `<div class="row-ko">${escapeHtml(s.ko)}</div>` : ''}
          </div>
        </div>
        <div class="row-detail">
          <button class="row-listen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon></svg>듣기</button>
          <button class="row-edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>수정</button>
          <button class="row-reset"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>다시 연습</button>
          <button class="row-delete danger"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>삭제</button>
        </div>
      </div>`;
  }).join('');

  $$('.sent-row').forEach(row => {
    const id = row.getAttribute('data-id');
    row.querySelector('.row-top').addEventListener('click', () => {
      row.classList.toggle('open');
    });
    row.querySelector('.row-listen').addEventListener('click', (e) => {
      e.stopPropagation();
      const s = sentences.find(s => s.id === id);
      if (s) speak(s.text);
    });
    row.querySelector('.row-edit').addEventListener('click', (e) => {
      e.stopPropagation();
      openEditModal(id);
    });
    row.querySelector('.row-reset').addEventListener('click', async (e) => {
      e.stopPropagation();
      const s = sentences.find(s => s.id === id);
      if (s) {
        s.box = 1;
        await saveSentences();
        renderList($('#searchInput').value);
        updateProgressHeader();
        showToast('다시 연습 목록에 넣었어요.');
      }
    });
    row.querySelector('.row-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      pendingDeleteId = id;
      pendingAction = 'deleteSentence';
      $('#confirmTitle').textContent = '문장을 삭제할까요?';
      $('#confirmBody').textContent = '삭제하면 되돌릴 수 없어요.';
      $('#confirmModal').classList.add('show');
    });
  });
}

/* ---------------- add sentences ---------------- */

async function addSentencesFromText(raw, koRaw, autoTranslate) {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return { count: 0, mismatched: false };

  const koLines = (koRaw || '').split('\n').map(l => l.trim());
  while (koLines.length && koLines[koLines.length - 1] === '') koLines.pop();
  const hasAnyKoInput = koLines.some(l => l.length > 0);
  const mismatched = hasAnyKoInput && koLines.length !== lines.length;
  const safeKoLines = mismatched ? [] : koLines;

  const newItems = lines.map((line, i) => ({
    id: makeId(),
    html: toDisplayHtml(line),
    text: toPlainText(line),
    ko: (safeKoLines[i] || '').trim(),
    box: 1,
    reviews: 0
  }));

  const needsTranslation = newItems.filter(item => !item.ko);
  if (autoTranslate && needsTranslation.length > 0) {
    showToast('한글 뜻을 번역하고 있어요...');
    for (const item of needsTranslation) {
      item.ko = await translateToKorean(item.text);
    }
  }

  sentences.push(...newItems);
  await saveSentences();
  buildQueue();
  buildDictQueue();
  return { count: lines.length, mismatched };
}

function openEditModal(id) {
  const s = sentences.find(s => s.id === id);
  if (!s) return;
  pendingEditId = id;
  $('#editTextareaEn').value = htmlToRaw(s.html);
  $('#editTextareaKo').value = s.ko || '';
  $('#editModal').classList.add('show');
}

async function saveEdit() {
  const s = sentences.find(s => s.id === pendingEditId);
  if (!s) return;
  const rawEn = $('#editTextareaEn').value.trim();
  const ko = $('#editTextareaKo').value.trim();
  if (rawEn) {
    s.html = toDisplayHtml(rawEn);
    s.text = toPlainText(rawEn);
  }
  s.ko = ko;
  await saveSentences();
  buildQueue();
  buildDictQueue();
  $('#editModal').classList.remove('show');
  pendingEditId = null;
  renderList($('#searchInput').value);
  if (currentTab === 'study') renderStudyCard();
  showToast('문장을 수정했어요.');
}

/* ---------------- settings view wiring ---------------- */

function renderSettingsUI() {
  $('#rateRange').value = settings.rate;
  $('#rateLabel').textContent = `${settings.rate.toFixed(2)}x`;
  $('#switchAutoplay').classList.toggle('on', settings.autoplay);
  $('#switchShuffle').classList.toggle('on', settings.shuffle);
  $('#switchAutoAdvance').classList.toggle('on', settings.autoAdvance);
  $('#autoAdvanceSeconds').value = settings.autoAdvanceSeconds;
  refreshVoices();
  syncQuickToggles();
}

function syncQuickToggles() {
  $('#toggleAutoplay').classList.toggle('on', settings.autoplay);
  $('#toggleShuffle').classList.toggle('on', settings.shuffle);
  $('#toggleAutoAdvance').classList.toggle('on', settings.autoAdvance);
}

/* ---------------- tab switching ---------------- */

function switchTab(tab) {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  currentTab = tab;
  $$('.view').forEach(v => v.classList.remove('active'));
  $(`#view-${tab}`).classList.add('active');
  $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('#fabAdd').style.display = tab === 'list' ? 'flex' : 'none';
  if (tab === 'list') renderList($('#searchInput').value);
  if (tab === 'settings') renderSettingsUI();
  if (tab !== 'study') clearAutoAdvance();
  if (tab === 'study') renderStudyCard();
  if (tab === 'dictation') renderDictationCard();
}

/* ---------------- event bindings ---------------- */

function bindEvents() {
  $$('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  $('#speakBtn').addEventListener('click', () => {
    const s = currentSentence();
    if (s) speak(s.text);
  });
  $('#nextBtn').addEventListener('click', goNext);
  $('#prevBtn').addEventListener('click', goPrev);
  $('#practiceBtn').addEventListener('click', () => markSentence('practice'));
  $('#knowBtn').addEventListener('click', () => markSentence('know'));

  $('#toggleAutoplay').addEventListener('click', async () => {
    settings.autoplay = !settings.autoplay;
    await saveSettings();
    syncQuickToggles();
    renderSettingsUI();
  });
  $('#toggleShuffle').addEventListener('click', async () => {
    settings.shuffle = !settings.shuffle;
    await saveSettings();
    syncQuickToggles();
    buildQueue();
    buildDictQueue();
    renderStudyCard();
  });
  $('#toggleAutoAdvance').addEventListener('click', async () => {
    settings.autoAdvance = !settings.autoAdvance;
    await saveSettings();
    syncQuickToggles();
    renderStudyCard();
  });

  $('#searchInput').addEventListener('input', (e) => renderList(e.target.value));

  $('#fabAdd').addEventListener('click', () => {
    $('#addTextarea').value = '';
    $('#addTextareaKo').value = '';
    $('#autoTranslateCheck').checked = true;
    $('#addModal').classList.add('show');
  });
  $('#ocrImportBtn').addEventListener('click', () => $('#ocrFileInput').click());
  $('#ocrFileInput').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) await runOcrOnFile(file);
    e.target.value = '';
  });
  $('#addCancelBtn').addEventListener('click', () => $('#addModal').classList.remove('show'));
  $('#addConfirmBtn').addEventListener('click', async () => {
    const autoTranslate = $('#autoTranslateCheck').checked;
    const { count, mismatched } = await addSentencesFromText(
      $('#addTextarea').value,
      $('#addTextareaKo').value,
      autoTranslate
    );
    $('#addModal').classList.remove('show');
    if (count > 0) {
      if (mismatched) {
        showToast(`${count}개 추가됨. 한글 줄 수가 영어와 달라 자동 번역으로 채웠어요.`);
      } else {
        showToast(`${count}개 문장을 추가했어요.`);
      }
      renderList($('#searchInput').value);
      updateProgressHeader();
    }
  });

  $('#dictReplayBtn').addEventListener('click', replayDictation);
  $('#dictCheckBtn').addEventListener('click', checkDictation);
  $('#dictRetryBtn').addEventListener('click', retryDictation);
  $('#dictNextBtn').addEventListener('click', nextDictation);
  $('#dictInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !dictChecked) {
      e.preventDefault();
      checkDictation();
    }
  });

  $('#editCancelBtn').addEventListener('click', () => {
    $('#editModal').classList.remove('show');
    pendingEditId = null;
  });
  $('#editSaveBtn').addEventListener('click', saveEdit);

  $('#voiceSelect').addEventListener('change', async (e) => {
    settings.voiceName = e.target.value || null;
    await saveSettings();
  });
  $('#rateRange').addEventListener('input', (e) => {
    settings.rate = parseFloat(e.target.value);
    $('#rateLabel').textContent = `${settings.rate.toFixed(2)}x`;
  });
  $('#rateRange').addEventListener('change', async () => { await saveSettings(); });

  $('#switchAutoplay').addEventListener('click', async () => {
    settings.autoplay = !settings.autoplay;
    await saveSettings();
    renderSettingsUI();
  });
  $('#switchShuffle').addEventListener('click', async () => {
    settings.shuffle = !settings.shuffle;
    await saveSettings();
    renderSettingsUI();
    buildQueue();
    buildDictQueue();
  });
  $('#switchAutoAdvance').addEventListener('click', async () => {
    settings.autoAdvance = !settings.autoAdvance;
    await saveSettings();
    renderSettingsUI();
  });
  $('#autoAdvanceSeconds').addEventListener('change', async (e) => {
    const v = parseInt(e.target.value, 10);
    settings.autoAdvanceSeconds = isNaN(v) ? 5 : Math.min(30, Math.max(2, v));
    await saveSettings();
  });

  $('#resetProgressBtn').addEventListener('click', () => {
    pendingAction = 'resetProgress';
    $('#confirmTitle').textContent = '학습 진행도를 초기화할까요?';
    $('#confirmBody').textContent = '모든 문장이 다시 "새 문장" 상태가 돼요. 문장 목록은 그대로 남아요.';
    $('#confirmOkBtn').textContent = '초기화';
    $('#confirmModal').classList.add('show');
  });
  $('#resetAllBtn').addEventListener('click', () => {
    pendingAction = 'resetAll';
    $('#confirmTitle').textContent = '전체 데이터를 삭제할까요?';
    $('#confirmBody').textContent = '추가한 문장과 진행도가 모두 사라지고, 처음 업로드했던 기본 문장으로 되돌아가요.';
    $('#confirmOkBtn').textContent = '전체 삭제';
    $('#confirmModal').classList.add('show');
  });

  $('#confirmCancelBtn').addEventListener('click', closeConfirmModal);
  $('#confirmOkBtn').addEventListener('click', async () => {
    if (pendingAction === 'deleteSentence' && pendingDeleteId) {
      sentences = sentences.filter(s => s.id !== pendingDeleteId);
      await saveSentences();
      buildQueue();
      buildDictQueue();
      renderList($('#searchInput').value);
      updateProgressHeader();
      showToast('문장을 삭제했어요.');
    } else if (pendingAction === 'resetProgress') {
      sentences.forEach(s => { s.box = 1; s.reviews = 0; });
      await saveSentences();
      buildQueue();
      buildDictQueue();
      updateProgressHeader();
      if (currentTab === 'study') renderStudyCard();
      if (currentTab === 'list') renderList($('#searchInput').value);
      showToast('진행도를 초기화했어요.');
    } else if (pendingAction === 'resetAll') {
      sentences = JSON.parse(JSON.stringify(SEED_SENTENCES));
      await saveSentences();
      buildQueue();
      buildDictQueue();
      updateProgressHeader();
      if (currentTab === 'study') renderStudyCard();
      if (currentTab === 'list') renderList('');
      showToast('전체 데이터를 초기화했어요.');
    }
    closeConfirmModal();
  });

  $$('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('show');
    });
  });

  if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = refreshVoices;
  }
}

function closeConfirmModal() {
  $('#confirmModal').classList.remove('show');
  pendingAction = null;
  pendingDeleteId = null;
}

/* ---------------- init ---------------- */

async function init() {
  try {
    await loadAll();
  } catch (e) {
    console.error('loadAll failed, using seed data:', e);
    sentences = (typeof SEED_SENTENCES !== 'undefined')
      ? JSON.parse(JSON.stringify(SEED_SENTENCES))
      : [];
    settings = { ...DEFAULT_SETTINGS };
  }
  try {
    bindEvents();
    buildQueue();
    buildDictQueue();
    renderStudyCard();
    updateProgressHeader();
    refreshVoices();
  } catch (e) {
    console.error('init render failed:', e);
    const textEl = $('#sentenceText');
    if (textEl) textEl.innerHTML = '앱 시작 중 오류가 발생했어요. 페이지를 새로고침해보세요.';
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
