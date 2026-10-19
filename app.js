'use strict';
const $ = (selector) => document.querySelector(selector);
const storage = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage may be disabled. */ } },
};
const topics = {
  llm: { label: 'LANGUAGE MODELS', pattern: /\b(llms?|language models?|reasoning|alignment|fine-tuning|tokeniz\w*)\b/i },
  vision: { label: 'COMPUTER VISION', pattern: /\b(vision|visual|image|video|diffusion|3d|segmentation)\b/i },
  agents: { label: 'AGENTS', pattern: /\b(agents?|agentic|tool.use|multi-agent|harness)\b/i },
  robotics: { label: 'ROBOTICS', pattern: /\b(robots?|robotics|embodied|manipulation|locomotion)\b/i },
};
let topic = storage.get('start-topic');
if (topic !== 'all' && !Object.hasOwn(topics, topic)) topic = 'all';
let papers = [];
let feedDate = null;
let feedMode = 'loading';
let loading = false;
const cacheKey = 'start-papers-v1';
const cacheTTL = 30 * 60 * 1000;

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('#theme-toggle').setAttribute('aria-label', theme === 'dark' ? '밝은 테마로 전환' : '어두운 테마로 전환');
  storage.set('start-neutral-glass-theme', theme);
}
const savedTheme = storage.get('start-neutral-glass-theme');
setTheme(['dark', 'light'].includes(savedTheme) ? savedTheme : 'light');
$('#theme-toggle').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
function updateClock() {
  const now = new Date();
  $('#clock').textContent = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(now);
  $('#clock').dateTime = now.toISOString();
  $('#date').textContent = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' }).format(now);
}
updateClock();
setInterval(updateClock, 1000);

function normalize(data) {
  if (!Array.isArray(data)) throw new Error('Invalid papers response');
  const seen = new Set();
  return data.flatMap((entry) => {
    const paper = entry?.paper;
    if (!paper || typeof paper.id !== 'string' || !/^\d{4}\.\d{4,5}(v\d+)?$/.test(paper.id) || typeof paper.title !== 'string' || seen.has(paper.id)) return [];
    seen.add(paper.id);
    return [{
      id: paper.id,
      title: paper.title,
      summary: typeof paper.ai_summary === 'string' ? paper.ai_summary : (typeof paper.summary === 'string' ? paper.summary : ''),
      // Match the full abstract, even when a short summary is displayed.
      search: `${paper.title} ${paper.summary || ''} ${(Array.isArray(paper.ai_keywords) ? paper.ai_keywords : []).join(' ')}`,
      date: typeof paper.publishedAt === 'string' ? paper.publishedAt : '',
      votes: Number.isFinite(paper.upvotes) ? Math.max(0, paper.upvotes) : 0,
    }];
  }).sort((a, b) => b.votes - a.votes || b.date.localeCompare(a.date));
}
function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}
function card(paper) {
  const link = element('a', 'paper-card');
  link.href = `https://huggingface.co/papers/${encodeURIComponent(paper.id)}`;
  const top = element('div', 'paper-top');
  const category = topic === 'all' ? Object.values(topics).find((item) => item.pattern.test(paper.search))?.label || 'RESEARCH' : topics[topic].label;
  const date = new Date(paper.date);
  top.append(element('span', 'paper-category', category), element('span', 'paper-date', Number.isNaN(date.getTime()) ? 'Daily Papers' : new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric' }).format(date)));
  const bottom = element('div', 'paper-bottom');
  bottom.append(element('span', '', `↑ ${paper.votes} 추천`), element('span', 'arrow', '↗'));
  link.append(top, element('h3', '', paper.title), element('p', 'paper-summary', paper.summary || '논문을 열어 자세히 읽어보세요.'), bottom);
  return link;
}
function render() {
  document.querySelectorAll('.filter').forEach((button) => {
    const active = button.dataset.topic === topic;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const selected = topic === 'all' ? papers : papers.filter((paper) => topics[topic].pattern.test(paper.search));
  $('#papers').replaceChildren(...selected.slice(0, 6).map(card));
  $('#papers').setAttribute('aria-busy', 'false');
  $('#feed-error').hidden = feedMode !== 'error';
  const stamp = feedDate ? new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(feedDate) : '';
  const prefix = feedMode === 'stale' ? `연결이 원활하지 않아 ${stamp}에 저장한 목록을 표시해요. ` : stamp ? `${stamp} 업데이트 · ` : '';
  $('#feed-status').textContent = feedMode === 'error' ? '논문을 불러오지 못했어요. 새로고침으로 다시 시도할 수 있어요.' : prefix + (selected.length ? `오늘의 ${selected.length}편 중 ${Math.min(selected.length, 6)}편을 골랐어요.` : topic === 'all' ? '아직 등록된 논문이 없어요. 잠시 뒤 다시 확인해 주세요.' : '오늘은 이 분야에 해당하는 논문이 없어요. 다른 관심 분야를 둘러보세요.');
}
async function loadPapers(force = false) {
  if (loading) return;
  loading = true;
  $('#refresh').disabled = true;
  const cached = storage.get(cacheKey);
  let cachedPapers = [];
  let cachedTime = 0;
  try {
    if (cached && Number.isFinite(cached.time) && cached.time > 0 && cached.time <= Date.now()) {
      cachedPapers = normalize(cached.data);
      cachedTime = cached.time;
    }
  } catch { /* Ignore malformed caches. */ }
  if (cachedTime && !force && Date.now() - cachedTime < cacheTTL) {
    papers = cachedPapers; feedDate = new Date(cachedTime); feedMode = 'cached'; render();
    loading = false; $('#refresh').disabled = false; return;
  }
  if (!papers.length) {
    $('#papers').replaceChildren(...Array.from({ length: 3 }, () => { const node = element('div', 'skeleton'); node.setAttribute('aria-hidden', 'true'); return node; }));
  }
  $('#papers').setAttribute('aria-busy', 'true');
  $('#feed-error').hidden = true;
  $('#feed-status').textContent = '오늘의 논문을 가져오고 있어요.';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    // Fetch the public feed directly, including when opened as a local HTML file.
    const response = await fetch('https://huggingface.co/api/daily_papers', {
      signal: controller.signal, credentials: 'omit', cache: 'no-store',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    papers = normalize(data);
    feedDate = new Date(); feedMode = 'live';
    storage.set(cacheKey, { time: feedDate.getTime(), data });
  } catch {
    if (!papers.length && cachedTime) { papers = cachedPapers; feedDate = new Date(cachedTime); }
    feedMode = papers.length || cachedTime ? 'stale' : 'error';
  } finally {
    clearTimeout(timeout); loading = false; $('#refresh').disabled = false; render();
  }
}
document.querySelectorAll('.filter').forEach((button) => button.addEventListener('click', () => {
  topic = button.dataset.topic; storage.set('start-topic', topic);
  if (feedMode !== 'loading') render();
  else document.querySelectorAll('.filter').forEach((item) => { const active = item.dataset.topic === topic; item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active)); });
}));
$('#refresh').addEventListener('click', () => loadPapers(true));
loadPapers();
