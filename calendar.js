/* Read-only Google Calendar renderer. Credentials stay on the client. */
(() => {
  'use strict';
  const key = 'start-google-calendar';
  const configKey = 'start-google-calendar-api';
  const scopes = ['https://www.googleapis.com/auth/calendar.events.readonly', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly'];
  const colors = ['#7895bd', '#9a8fb2', '#719f97', '#b39479', '#9c8996', '#7d9caa'];
  let month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let selectedDate = dayKey(new Date());
  let events = [];
  let phase = 'setup';
  let request = null;
  let revision = 0;
  let token = '';
  let tokenExpires = 0;
  let tokenTimer;
  let identityPromise;
  let importing = false;
  let authGeneration = 0;
  const savedConfig = storage.get(configKey);
  let config = {
    viewMode: savedConfig?.viewMode === 'custom' ? 'custom' : 'google',
    apiKey: typeof savedConfig?.apiKey === 'string' ? savedConfig.apiKey : '',
    clientId: typeof savedConfig?.clientId === 'string' ? savedConfig.clientId : '',
  };
  function dayKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
  function localDate(value) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(NaN); const [y, m, d] = value.split('-').map(Number); const date = new Date(y, m - 1, d); return dayKey(date) === value ? date : new Date(NaN); }
  function validId(id) { return typeof id === 'string' && id.length <= 320 && /^[^\s<>"'@]+@[^\s<>"'@]+\.[^\s<>"'@]+$/.test(id); }
  function normalizeCalendars(value) {
    const source = typeof value === 'string' ? [{ id: value, name: '내 캘린더', enabled: true }] : Array.isArray(value) ? value : [];
    const seen = new Set();
    return source.flatMap(item => {
      if (!item || !validId(item.id) || seen.has(item.id)) return [];
      seen.add(item.id);
      return [{ id: item.id, name: typeof item.name === 'string' ? item.name.slice(0, 80) : '', enabled: item.enabled !== false, color: typeof item.color === 'string' && /^#[0-9a-f]{6}$/i.test(item.color) ? item.color : undefined }];
    });
  }
  let calendars = normalizeCalendars(storage.get(key));
  // Calendar settings are entered locally by each visitor.
  function colorFor(id) {
    const chosen = calendars.find(calendar => calendar.id === id)?.color;
    if (chosen) return chosen;
    let hash = 0;
    for (const char of id) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
    return colors[(hash >>> 0) % colors.length];
  }
  function range() {
    const start = new Date(month.getFullYear(), month.getMonth(), 1);
    start.setDate(start.getDate() - start.getDay());
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const end = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 7 - last.getDay());
    return { start, end };
  }
  function safeLink(value) {
    try { const url = new URL(value); return url.protocol === 'https:' && ['calendar.google.com', 'www.google.com'].includes(url.hostname) ? url.href : ''; } catch { return ''; }
  }
  function normalizeEvents(items, calendar) {
    return items.flatMap(item => {
      if (!item || item.status === 'cancelled') return [];
      const allDay = typeof item.start?.date === 'string';
      const start = allDay ? localDate(item.start.date) : new Date(item.start?.dateTime);
      const end = allDay ? localDate(item.end?.date || '') : new Date(item.end?.dateTime);
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return [];
      return [{ id: `${calendar.id}:${item.id || start.toISOString()}`, title: typeof item.summary === 'string' ? item.summary : '제목 없는 일정', start, end, allDay, link: safeLink(item.htmlLink), calendarId: calendar.id, calendarName: calendar.name || calendar.id, location: typeof item.location === 'string' ? item.location : '' }];
    });
  }
  function eventsFor(date) {
    const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    return events.filter(event => event.start < end && event.end > date).sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start || a.title.localeCompare(b.title));
  }
  function eventTime(event, date) {
    if (event.allDay) return '종일';
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    const format = value => new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }).format(value);
    return `${event.start < date ? '이전 날부터' : format(event.start)} – ${event.end > next ? '다음 날까지' : format(event.end)}`;
  }
  function renderAgenda() {
    const date = localDate(selectedDate);
    $('#calendar-agenda-title').textContent = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }).format(date);
    const list = eventsFor(date);
    const nodes = list.map(event => {
      const card = element(event.link ? 'a' : 'div', 'calendar-event-detail');
      if (event.link) { card.href = event.link; card.target = '_blank'; card.rel = 'noopener noreferrer'; }
      card.style.setProperty('--calendar-color', colorFor(event.calendarId));
      card.append(element('span', 'calendar-event-time', eventTime(event, date)), element('strong', '', event.title), element('span', 'calendar-event-source', event.calendarName));
      if (event.location) card.append(element('span', 'calendar-event-location', event.location));
      return card;
    });
    if (!nodes.length) nodes.push(element('p', 'calendar-agenda-empty', phase === 'loading' ? '일정을 불러오는 중입니다.' : phase === 'setup' ? '연결 설정에서 Google 일정 데이터를 연결하세요.' : phase === 'error' ? '일정을 불러오지 못했습니다.' : phase === 'partial' ? '표시할 일정이 없습니다. 일부 캘린더는 조회하지 못했습니다.' : phase === 'empty' ? '연결 설정에서 표시할 캘린더를 선택하세요.' : '등록된 일정이 없습니다.'));
    $('#calendar-agenda-list').replaceChildren(...nodes);
  }
  function renderMonth() {
    const today = dayKey(new Date());
    $('#calendar-month').textContent = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long' }).format(month);
    const { start, end } = range();
    const nodes = [];
    for (let date = new Date(start); date < end; date.setDate(date.getDate() + 1)) {
      const dateId = dayKey(date);
      const items = eventsFor(date);
      const cell = element('button', 'calendar-day');
      cell.type = 'button';
      cell.classList.toggle('outside-month', date.getMonth() !== month.getMonth());
      cell.classList.toggle('is-today', dateId === today);
      cell.setAttribute('aria-pressed', String(dateId === selectedDate));
      cell.setAttribute('aria-label', `${new Intl.DateTimeFormat('ko-KR', { dateStyle: 'full' }).format(date)}${phase === 'ready' || phase === 'partial' ? `, 일정 ${items.length}개` : ''}`);
      const time = element('time', '', String(date.getDate()));
      time.dateTime = dateId;
      if (dateId === today) time.setAttribute('aria-current', 'date');
      cell.append(time);
      items.slice(0, 2).forEach(event => {
        const chip = element('span', 'calendar-event-chip', `${event.allDay ? '' : new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(event.start) + ' '}${event.title}`);
        chip.style.setProperty('--calendar-color', colorFor(event.calendarId));
        chip.title = event.title;
        cell.append(chip);
      });
      if (items.length > 2) cell.append(element('span', 'calendar-event-more', `+${items.length - 2}개`));
      cell.addEventListener('click', () => { selectedDate = dateId; renderMonth(); });
      nodes.push(cell);
    }
    $('#calendar-days').replaceChildren(...nodes);
    renderAgenda();
  }
  function showSettings(open) {
    $('#calendar-settings').hidden = !open;
    $('#calendar-api-settings').hidden = !open;
    $('#calendar-settings-toggle').setAttribute('aria-expanded', String(open));
    if (open) $('#calendar-id').focus();
  }
  function renderList() {
    const rows = calendars.map(calendar => {
      const row = element('div', 'calendar-list-row');
      const label = element('label', 'calendar-choice');
      const checkbox = element('input');
      checkbox.type = 'checkbox'; checkbox.checked = calendar.enabled;
      checkbox.addEventListener('change', () => { calendar.enabled = checkbox.checked; saveCalendars(); loadEvents(); });
      const dot = element('span', 'calendar-color-dot'); dot.style.backgroundColor = colorFor(calendar.id);
      const text = element('span', 'calendar-choice-text');
      text.append(element('span', 'calendar-choice-name', calendar.name || calendar.id), element('small', '', calendar.id));
      label.append(checkbox, dot, text);
      const remove = element('button', 'calendar-button', '삭제'); remove.type = 'button'; remove.setAttribute('aria-label', `${calendar.name || calendar.id} 삭제`);
      remove.addEventListener('click', () => { calendars = calendars.filter(item => item.id !== calendar.id); saveCalendars(); renderList(); loadEvents(); });
      row.append(label, remove); return row;
    });
    $('#calendar-list').replaceChildren(...rows);
    $('#calendar-list').hidden = !calendars.length;
    $('#calendar-disconnect').hidden = !calendars.length;
    $('#calendar-settings-toggle').textContent = '연결 설정';
  }
  function saveCalendars() { storage.set(key, calendars); }
  function usableOrigin() { return location.protocol === 'https:' || location.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname); }
  function hasToken() { return token && Date.now() < tokenExpires; }
  function updateAuth() {
    $('#calendar-import').disabled = !hasToken() || importing;
    $('#calendar-logout').hidden = !hasToken();
    $('#calendar-login').textContent = hasToken() ? '계정 다시 연결' : 'Google 로그인';
    $('#calendar-auth-help').textContent = usableOrigin() ? `비공개 일정 로그인에는 이 주소(${location.origin})를 Google OAuth 허용 출처로 등록해야 합니다. 공개 캘린더는 API 키만으로 조회합니다.` : '로컬 HTML에서는 공개 캘린더를 API 키로 조회할 수 있습니다. 비공개 일정 로그인에는 Google에 등록한 HTTPS 주소 또는 localhost에서 이 페이지를 열어야 합니다.';
  }
  async function api(path, parameters, signal) {
    const url = new URL(`https://www.googleapis.com/calendar/v3/${path}`);
    Object.entries(parameters).forEach(([name, value]) => { if (value !== undefined && value !== '') url.searchParams.set(name, value); });
    const headers = {};
    if (hasToken()) headers.Authorization = `Bearer ${token}`;
    else if (config.apiKey) url.searchParams.set('key', config.apiKey);
    else throw new Error('연결 설정이 필요합니다.');
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 15000);
    try {
      const response = await fetch(url.href, { headers, signal: controller.signal, credentials: 'omit', cache: 'no-store' });
      if (!response.ok) { const error = new Error(`Google API ${response.status}`); error.status = response.status; throw error; }
      return await response.json();
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
  }
  async function readCalendar(calendar, bounds, signal) {
    let page = ''; const items = []; const pages = new Set();
    do {
      const data = await api(`calendars/${encodeURIComponent(calendar.id)}/events`, { timeMin: bounds.start.toISOString(), timeMax: bounds.end.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '2500', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, pageToken: page }, signal);
      if (!Array.isArray(data.items)) throw new Error('잘못된 일정 응답');
      items.push(...data.items);
      page = typeof data.nextPageToken === 'string' ? data.nextPageToken : '';
      if (page && pages.has(page)) throw new Error('반복된 페이지');
      pages.add(page);
    } while (page);
    return normalizeEvents(items, calendar);
  }
  function showGoogleFallback(visible) {
    $('#calendar-google-fallback').hidden = !visible;
    $('#calendar-custom-view').hidden = visible;
    if (visible) {
      const url = new URL($('#calendar-google-link').href);
      url.searchParams.set('hl', 'ko');
      url.searchParams.set('showTitle', '0');
      url.searchParams.set('showPrint', '0');
      url.searchParams.set('showCalendars', '1');
      url.searchParams.set('mode', 'MONTH');
      if ($('#calendar-google-frame').src !== url.href) $('#calendar-google-frame').src = url.href;
    } else {
      $('#calendar-google-frame').removeAttribute('src');
    }
  }
  async function loadEvents() {
    request?.abort(); const current = ++revision;
    const selected = calendars.filter(item => item.enabled);
    events = []; updateAuth();
    const link = new URL('https://calendar.google.com/calendar/embed');
    selected.forEach(item => { link.searchParams.append('src', item.id); link.searchParams.append('color', colorFor(item.id)); });
    link.searchParams.set('wkst', '1');
    link.searchParams.set('height', '600');
    link.searchParams.set('showPrint', '0');
    link.searchParams.set('ctz', 'Asia/Seoul');
    $('#calendar-google-link').href = selected.length ? link.href : 'https://calendar.google.com/';
    showGoogleFallback(false);
    if (selected.length && config.viewMode === 'google') {
      phase = 'embedded';
      showGoogleFallback(true);
      $('#calendar-status').textContent = `${selected.length}개 캘린더 · 서울 시간 · 월요일 시작. 일정이 보이지 않으면 해당 Google 계정의 로그인·열람 권한을 확인하세요.`;
      $('#calendar-days').setAttribute('aria-busy', 'false');
      $('#calendar-refresh').disabled = false;
      return;
    }
    if (!selected.length || !hasToken() && !config.apiKey) {
      phase = selected.length ? 'setup' : 'empty';
      $('#calendar-status').textContent = selected.length ? 'Google 캘린더로 표시 중입니다. 직접 그린 달력은 일정 데이터 인증이 필요합니다. Google 화면에도 일정이 없다면 로그인·캘린더 열람 권한을 확인하세요.' : '표시할 캘린더를 선택하세요.';
      showGoogleFallback(selected.length > 0);
      $('#calendar-days').setAttribute('aria-busy', 'false'); $('#calendar-refresh').disabled = false; renderMonth(); return;
    }
    phase = 'loading'; $('#calendar-status').textContent = '일정을 가져오는 중입니다.';
    $('#calendar-days').setAttribute('aria-busy', 'true'); $('#calendar-refresh').disabled = true; renderMonth();
    const controller = new AbortController(); request = controller;
    const bounds = range(); const results = new Array(selected.length); let index = 0;
    await Promise.all(Array.from({ length: Math.min(4, selected.length) }, async () => {
      while (index < selected.length && !controller.signal.aborted) {
        const position = index++;
        try { results[position] = { calendar: selected[position], events: await readCalendar(selected[position], bounds, controller.signal) }; }
        catch (error) { results[position] = { calendar: selected[position], error }; }
      }
    }));
    if (current !== revision || controller.signal.aborted) return;
    const good = results.filter(item => item && !item.error); const bad = results.filter(item => item?.error);
    events = good.flatMap(item => item.events);
    phase = bad.length ? good.length ? 'partial' : 'error' : 'ready';
    const stamp = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' }).format(new Date());
    $('#calendar-status').textContent = bad.length ? `${good.length}/${selected.length}개 캘린더 조회 · 읽지 못한 캘린더: ${bad.map(item => item.calendar.name || item.calendar.id).join(', ')}. API 키·열람 권한·로그인을 확인하세요.` : `${selected.length}개 캘린더 · ${events.length}개 일정 · ${stamp} 업데이트`;
    if (bad.some(item => item.error.status === 401) && token) {
      token = ''; tokenExpires = 0; clearTimeout(tokenTimer); events = []; phase = 'error';
      $('#calendar-status').textContent = '로그인이 만료되었습니다. Google 로그인 버튼으로 다시 연결하세요.';
      updateAuth();
    }
    showGoogleFallback(phase === 'error');
    $('#calendar-days').setAttribute('aria-busy', 'false'); $('#calendar-refresh').disabled = false; renderMonth();
  }
  function loadIdentity() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    if (identityPromise) return identityPromise;
    identityPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
      const timeout = setTimeout(() => { script.remove(); identityPromise = null; reject(new Error('로그인 라이브러리를 불러오지 못했습니다.')); }, 15000);
      script.onload = () => { clearTimeout(timeout); if (window.google?.accounts?.oauth2) resolve(); else { identityPromise = null; reject(new Error('로그인을 준비하지 못했습니다.')); } };
      script.onerror = () => { clearTimeout(timeout); script.remove(); identityPromise = null; reject(new Error('Google 로그인 연결을 확인하세요.')); };
      document.head.append(script);
    });
    return identityPromise;
  }
  async function importCalendars() {
    if (!hasToken() || importing) return;
    importing = true; const importToken = token; updateAuth();
    try {
      let page = ''; const pages = new Set(); const items = [];
      do {
        const data = await api('users/me/calendarList', { maxResults: '250', showHidden: 'true', pageToken: page });
        if (!Array.isArray(data.items)) throw new Error('목록을 읽지 못했습니다.');
        items.push(...data.items); page = typeof data.nextPageToken === 'string' ? data.nextPageToken : '';
        if (page && pages.has(page)) throw new Error('반복된 페이지');
        pages.add(page);
      } while (page);
      // Do not merge results after the user has ended this login session.
      if (!hasToken() || token !== importToken) return;
      let added = 0;
      items.filter(item => !item.deleted && validId(item.id)).forEach(item => {
        const existing = calendars.find(calendar => calendar.id === item.id);
        const name = typeof item.summaryOverride === 'string' ? item.summaryOverride : typeof item.summary === 'string' ? item.summary : '';
        if (existing) { if (!existing.name) existing.name = name.slice(0, 80); }
        else { calendars.push({ id: item.id, name: name.slice(0, 80), enabled: item.selected !== false && !item.hidden }); added++; }
      });
      saveCalendars(); renderList(); loadEvents();
      $('#calendar-auth-status').textContent = `내 캘린더와 구독 목록에서 ${added}개를 추가했습니다. 표시할 항목을 체크하세요.`;
    } catch { $('#calendar-auth-status').textContent = '구독 목록을 읽지 못했습니다. 목록 읽기 권한을 허용하고 다시 로그인하세요.'; }
    finally { importing = false; updateAuth(); }
  }
  $('#calendar-settings-toggle').addEventListener('click', () => showSettings($('#calendar-settings').hidden));
  $('#calendar-settings').addEventListener('submit', event => {
    event.preventDefault(); const id = $('#calendar-id').value.trim();
    if (!validId(id)) { $('#calendar-settings-status').textContent = '이메일 형식의 캘린더 ID를 입력하세요.'; return; }
    const name = $('#calendar-name').value.trim().slice(0, 80); const existing = calendars.find(item => item.id === id);
    if (existing) { existing.enabled = true; if (name) existing.name = name; } else calendars.push({ id, name, enabled: true });
    saveCalendars(); renderList(); loadEvents(); $('#calendar-id').value = ''; $('#calendar-name').value = ''; $('#calendar-settings-status').textContent = '캘린더를 추가했습니다.';
  });
  $('#calendar-disconnect').addEventListener('click', () => { calendars = []; saveCalendars(); renderList(); loadEvents(); });
  $('#calendar-save-api').addEventListener('click', () => {
    const clientId = $('#calendar-client-id').value.trim(); const apiKey = $('#calendar-api-key').value.trim();
    if (clientId && !/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId)) { $('#calendar-auth-status').textContent = 'Google 웹용 OAuth 클라이언트 ID를 확인하세요.'; return; }
    if (clientId !== config.clientId) { authGeneration++; token = ''; tokenExpires = 0; clearTimeout(tokenTimer); }
    config = { clientId, apiKey, viewMode: $('#calendar-view-mode').value === 'custom' ? 'custom' : 'google' }; storage.set(configKey, config); updateAuth(); loadEvents();
    $('#calendar-auth-status').textContent = '연결 설정을 저장했습니다.';
    if (config.clientId && usableOrigin()) loadIdentity().catch(error => { $('#calendar-auth-status').textContent = error.message; });
  });
  $('#calendar-login').addEventListener('click', () => {
    showSettings(true);
    if (!usableOrigin()) { $('#calendar-auth-status').textContent = 'Google 로그인은 file:// 주소를 지원하지 않습니다. 등록된 HTTPS 주소 또는 localhost에서 열어야 합니다. 공개 캘린더는 API 키를 사용할 수 있습니다.'; return; }
    if (!config.clientId) { $('#calendar-auth-status').textContent = '먼저 OAuth 클라이언트 ID를 저장하세요.'; return; }
    if (!window.google?.accounts?.oauth2) { loadIdentity().then(() => { $('#calendar-auth-status').textContent = '준비되었습니다. Google 로그인 버튼을 다시 눌러 주세요.'; }).catch(error => { $('#calendar-auth-status').textContent = error.message; }); return; }
    const authAttempt = ++authGeneration;
    try {
      window.google.accounts.oauth2.initTokenClient({
        client_id: config.clientId, scope: scopes.join(' '),
        callback: response => {
          if (authAttempt !== authGeneration) return;
          if (response.error || !response.access_token || !window.google.accounts.oauth2.hasGrantedAllScopes(response, scopes[0])) { $('#calendar-auth-status').textContent = '일정 읽기 권한이 필요합니다. Google 로그인을 다시 시도하세요.'; return; }
          token = response.access_token; tokenExpires = Date.now() + Math.max(0, Number(response.expires_in) - 30) * 1000;
          clearTimeout(tokenTimer); tokenTimer = setTimeout(() => { token = ''; tokenExpires = 0; updateAuth(); loadEvents(); $('#calendar-auth-status').textContent = '로그인이 만료되었습니다. 다시 연결하세요.'; }, Math.max(0, tokenExpires - Date.now()));
          updateAuth(); loadEvents();
          $('#calendar-auth-status').textContent = 'Google 일정 읽기를 허용했습니다.';
          if (window.google.accounts.oauth2.hasGrantedAllScopes(response, scopes[1])) importCalendars();
        },
        error_callback: () => { $('#calendar-auth-status').textContent = '로그인 창이 닫혔거나 차단되었습니다. 다시 시도하세요.'; },
      }).requestAccessToken();
    } catch { $('#calendar-auth-status').textContent = 'Google 로그인 설정과 허용 출처를 확인하세요.'; }
  });
  $('#calendar-import').addEventListener('click', importCalendars);
  $('#calendar-logout').addEventListener('click', () => { authGeneration++; token = ''; tokenExpires = 0; clearTimeout(tokenTimer); updateAuth(); loadEvents(); $('#calendar-auth-status').textContent = '이 페이지의 로그인 연결을 종료했습니다.'; });
  function moveMonth(offset) { month = new Date(month.getFullYear(), month.getMonth() + offset, 1); selectedDate = dayKey(month); loadEvents(); }
  $('#calendar-prev').addEventListener('click', () => moveMonth(-1));
  $('#calendar-next').addEventListener('click', () => moveMonth(1));
  $('#calendar-today').addEventListener('click', () => { const now = new Date(); month = new Date(now.getFullYear(), now.getMonth(), 1); selectedDate = dayKey(now); loadEvents(); });
  $('#calendar-refresh').addEventListener('click', () => {
    if (!$('#calendar-google-fallback').hidden) $('#calendar-google-frame').removeAttribute('src');
    loadEvents();
  });
  $('#calendar-view-mode').value = config.viewMode;
  $('#calendar-api-key').value = config.apiKey; $('#calendar-client-id').value = config.clientId;
  updateAuth(); renderList(); loadEvents();
  if (config.clientId && usableOrigin()) loadIdentity().catch(() => {});
})();
