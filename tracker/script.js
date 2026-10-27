'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const storageKey = 'wight-signal-tracker:watchlist:v1';
  const pageSize = 25;
  const query = new URLSearchParams(location.search);
  const validViews = ['all', 'built', 'attention', 'saved'];
  const state = {
    search: query.get('q') || '', stream: query.get('workstream') || 'all',
    stage: query.get('stage') || 'all',
    view: validViews.includes(query.get('view')) ? query.get('view') : 'all',
    sort: ['workstream', 'attention', 'stage'].includes(query.get('sort')) ? query.get('sort') : 'workstream',
    limit: pageSize
  };
  let project;
  let stages;
  let streams;
  let filtered = [];
  let toastTimer;
  let watchlist = new Set();
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (Array.isArray(stored)) watchlist = new Set(stored.filter(x => typeof x === 'string'));
  } catch { /* Browsers may disable storage; in-memory bookmarks still work. */ }

  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const dateLabel = date => new Intl.DateTimeFormat('en-GB', {day:'numeric', month:'short', year:'numeric', timeZone:'UTC'}).format(new Date(`${date}T12:00:00Z`));
  const pill = item => `<span class="status-pill" data-stage="${escape(item.stage)}"><span class="dot" aria-hidden="true"></span>${escape(stages[item.stage].label)}</span>`;
  const bookmarkIcon = '<svg viewBox="0 0 16 20" aria-hidden="true"><path d="M3 2h10v15l-5-3-5 3z"/></svg>';

  function toast(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
  }

  function viewUrl(includeHash = true) {
    const params = new URLSearchParams();
    if (state.search) params.set('q', state.search);
    if (state.stream !== 'all') params.set('workstream', state.stream);
    if (state.stage !== 'all') params.set('stage', state.stage);
    if (!['all', 'saved'].includes(state.view)) params.set('view', state.view);
    if (state.sort !== 'workstream') params.set('sort', state.sort);
    return location.pathname + (params.size ? `?${params}` : '') + (includeHash ? location.hash : '');
  }

  function syncUrl() {
    history.replaceState(null, '', viewUrl(false));
  }

  function updateControls() {
    $('searchInput').value = state.search;
    $('statusFilter').value = state.stage;
    $('sortFilter').value = state.sort;
    $('mobileStream').value = state.stream;
    document.querySelectorAll('[data-view]').forEach(button => {
      const active = button.dataset.view === state.view;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll('.stream-button').forEach(button => {
      const active = button.dataset.stream === state.stream;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    $('savedCount').textContent = watchlist.size;
    $('personalNote').hidden = state.view !== 'saved';
  }

  function matches(item) {
    if (state.stream !== 'all' && item.stream !== state.stream) return false;
    if (state.stage !== 'all' && item.stage !== state.stage) return false;
    if (state.view === 'built' && !['built', 'tested', 'approved'].includes(item.stage)) return false;
    if (state.view === 'attention' && !['blocked', 'unknown'].includes(item.stage)) return false;
    if (state.view === 'saved' && !watchlist.has(item.id)) return false;
    if (state.search.trim()) {
      const haystack = [item.id, item.title, streams[item.stream].label, item.status, item.acceptance, item.evidence, item.nextAction, item.dependencies].join(' ').toLocaleLowerCase();
      if (!state.search.toLocaleLowerCase().trim().split(/\s+/).every(term => haystack.includes(term))) return false;
    }
    return true;
  }

  function taskMarkup(item, openIds) {
    const pinned = watchlist.has(item.id);
    const mark = item.stage === 'approved' ? '✓' : item.stage === 'blocked' ? '!' : ['tested', 'built'].includes(item.stage) ? '•' : '';
    return `<details class="task-item" id="task-${escape(item.id)}" data-stage="${escape(item.stage)}"${openIds.has(item.id) ? ' open' : ''}>
      <summary>
        <span class="task-mark" aria-hidden="true">${mark}</span>
        <span class="task-title-block"><span class="task-title">${escape(item.title)}</span><span class="task-subtitle">${escape(item.id)} <span aria-hidden="true">/</span> ${escape(streams[item.stream].label)}</span></span>
        ${pill(item)}
        <button class="pin-button" data-pin="${escape(item.id)}" type="button" aria-label="${pinned ? 'Remove' : 'Add'} ${escape(item.id)} ${pinned ? 'from' : 'to'} my watchlist" aria-pressed="${pinned}" title="${pinned ? 'Remove from' : 'Add to'} my watchlist">${bookmarkIcon}</button>
        <span class="task-chevron" aria-hidden="true">›</span>
      </summary>
      <div class="task-body"><div class="task-detail-grid">
        <div><span class="detail-label">The finish line</span><p>${escape(item.acceptance)}</p></div>
        <div class="next-action"><span class="detail-label">Next step</span><p>${escape(item.nextAction)}</p></div>
        <div><span class="detail-label">What the evidence says</span><p>${escape(item.evidence)}</p></div>
        <div><span class="detail-label">Dependencies & open questions</span><p>${escape(item.dependencies)}</p></div>
      </div><div class="task-meta"><span>Evidence audited ${escape(dateLabel(item.verifiedDate))}</span>${item.manualReview ? '<span class="review-label">Visual / manual approval required</span>' : '<span>Evidence-led check</span>'}<button type="button" class="copy-item" data-copy="${escape(item.id)}">Copy item link <span aria-hidden="true">↗</span></button></div></div>
    </details>`;
  }

  function render() {
    const openIds = new Set([...$('taskList').querySelectorAll('details[open]')].map(el => el.id.slice(5)));
    filtered = project.items.filter(matches);
    const idSort = (a, b) => a.stream.localeCompare(b.stream) || Number(a.id.includes('-')) - Number(b.id.includes('-')) || a.id.localeCompare(b.id, 'en', {numeric:true});
    const attentionOrder = ['blocked', 'unknown', 'planned', 'vector', 'source', 'built', 'tested', 'approved', 'not-started', 'stale', 'not-applicable'];
    filtered.sort((a, b) => {
      if (state.sort === 'attention') return attentionOrder.indexOf(a.stage) - attentionOrder.indexOf(b.stage) || idSort(a,b);
      if (state.sort === 'stage') return project.stages.findIndex(s => s.key === a.stage) - project.stages.findIndex(s => s.key === b.stage) || idSort(a,b);
      return idSort(a,b);
    });
    const visible = filtered.slice(0, state.limit);
    const streamName = state.stream === 'all' ? 'all workstreams' : streams[state.stream].label;
    $('resultsCount').textContent = `${filtered.length} ${filtered.length === 1 ? 'item' : 'items'} · ${streamName}`;
    const sections = [];
    let currentKey = null;
    for (const item of visible) {
      const key = state.sort === 'workstream' ? item.stream : item.stage;
      if (key !== currentKey) {
        const label = state.sort === 'workstream' ? streams[item.stream].label : stages[item.stage].label;
        const count = filtered.filter(x => state.sort === 'workstream' ? x.stream === key : x.stage === key).length;
        sections.push(`<h3 class="group-heading"><span class="group-code">${escape(state.sort === 'workstream' ? key : '•')}</span>${escape(label)}<span class="group-count">${count} ${count === 1 ? 'item' : 'items'}</span></h3>`);
        currentKey = key;
      }
      sections.push(taskMarkup(item, openIds));
    }
    $('taskList').innerHTML = sections.join('');
    $('taskList').setAttribute('aria-busy', 'false');
    $('emptyState').hidden = filtered.length !== 0;
    $('loadMoreWrap').hidden = visible.length >= filtered.length;
    $('loadMore').textContent = `Show ${Math.min(pageSize, filtered.length - visible.length)} more items ↓`;
    $('shownCount').textContent = `Showing ${visible.length} of ${filtered.length} matching items`;
    updateControls();
  }

  function changeFilters(changes) {
    Object.assign(state, changes, {limit:pageSize});
    syncUrl();
    render();
  }

  function resetFilters() {
    changeFilters({search:'', stream:'all', stage:'all', view:'all', sort:'workstream'});
  }

  function jumpTo(id) {
    const item = project.items.find(x => x.id === id);
    if (!item) return;
    Object.assign(state, {search:'', stream:item.stream, stage:'all', view:'all', sort:'workstream', limit:project.items.length});
    render();
    history.replaceState(null, '', viewUrl(false) + `#task-${encodeURIComponent(id)}`);
    requestAnimationFrame(() => {
      const details = document.getElementById(`task-${id}`);
      if (!details) return;
      details.open = true;
      details.querySelector('summary').focus({preventScroll:true});
      details.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block:'start'});
    });
  }

  async function copyText(text, success) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(text);
      toast(success);
    } catch {
      // The URL remains available in the address bar even on restricted browsers.
      history.replaceState(null, '', text);
      toast('Link is ready in the address bar. Copy it from there.');
    }
  }

  function exportCsv() {
    const columns = ['ID', 'Workstream', 'Item', 'Evidence stage', 'Finish line', 'Evidence', 'Next step', 'Dependencies', 'Manual approval required', 'Audit date'];
    const rows = filtered.map(x => [x.id, streams[x.stream].label, x.title, x.status, x.acceptance, x.evidence, x.nextAction, x.dependencies, x.manualReview ? 'Yes' : 'No', x.verifiedDate]);
    const cell = value => '"' + String(value).replace(/^[=+@-]/, char => "'" + char).replace(/"/g, '""') + '"';
    const blob = new Blob(['\ufeff' + [columns, ...rows].map(row => row.map(cell).join(',')).join('\r\n')], {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `wight-signal-checklist-${project.auditDate}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Downloaded ${filtered.length} matching checklist items.`);
  }

  function initialise() {
    stages = Object.fromEntries(project.stages.map(x => [x.key, x]));
    streams = Object.fromEntries(project.streams.map(x => [x.id, x]));
    if (!streams[state.stream]) state.stream = 'all';
    if (!stages[state.stage]) state.stage = 'all';
    watchlist = new Set([...watchlist].filter(id => project.items.some(x => x.id === id)));
    $('auditDate').textContent = `Baseline audit: ${dateLabel(project.auditDate)}`;
    if (project.updatedDate && project.updatedDate !== project.auditDate) { $('updateDate').textContent = `Latest decision: ${dateLabel(project.updatedDate)}`; $('updateDate').hidden = false; }
    $('footerDate').textContent = `Baseline audit · ${dateLabel(project.auditDate)}${project.updatedDate && project.updatedDate !== project.auditDate ? ' / Latest decision · ' + dateLabel(project.updatedDate) : ''}`;
    $('buildName').textContent = project.previewBuild;
    $('buildSummary').textContent = project.summary;
    $('totalCount').textContent = project.items.length;
    $('builtCount').textContent = stages.built.count;
    $('testedCount').textContent = stages.tested.count;
    $('blockedCount').textContent = stages.blocked.count;
    $('stageBar').innerHTML = project.stages.filter(s => s.count).map(s => `<span class="stage-segment" data-stage="${s.key}" style="flex-grow:${s.count}" title="${escape(s.label)}: ${s.count}"></span>`).join('');
    $('stageLegend').innerHTML = project.stages.filter(s => s.count).map(s => `<button class="legend-button" data-stage="${s.key}" data-stage-filter="${s.key}" type="button"><span class="dot" aria-hidden="true"></span>${escape(s.label)} <b>${s.count}</b></button>`).join('');
    $('statusFilter').innerHTML += project.stages.filter(s => s.count).map(s => `<option value="${s.key}">${escape(s.label)} (${s.count})</option>`).join('');
    $('mobileStream').innerHTML += project.streams.map(s => `<option value="${s.id}">${s.id}. ${escape(s.label)} (${s.count})</option>`).join('');
    const allButton = `<button class="stream-button active" data-stream="all" aria-pressed="true"><span class="stream-code">⌁</span><span>All workstreams</span><span class="stream-count">${project.items.length}</span></button>`;
    $('workstreams').innerHTML = allButton + project.streams.map(s => `<button class="stream-button" data-stream="${s.id}" aria-pressed="false"><span class="stream-code">${s.id}</span><span>${escape(s.label)}</span><span class="stream-count">${s.count}</span></button>`).join('');
    const focusCopy = {
      D07: ['Keep the paths open', 'Path and road clearances need to pass before boundary samples can roll out across the island.'],
      F03: ['Give the towns their character', 'The building masterplan is a vector draft. Street layouts and British character need review before broad conversion.'],
      I07: ['Check the world in-game', 'A preview has loaded; stability, current-version appearance and player traversal still need their own checks.']
    };
    $('focusCards').innerHTML = project.focusIds.map((id, i) => {
      const item = project.items.find(x => x.id === id);
      if (!item) return '';
      const copy = focusCopy[id] || [item.title, item.nextAction];
      return `<button class="focus-card" type="button" data-jump="${id}"><span class="focus-top"><span class="focus-number">0${i + 1} / ${id}</span>${pill(item)}</span><h3>${escape(copy[0])}</h3><p>${escape(copy[1])}</p><span class="focus-link">Open checklist item <span aria-hidden="true">↗</span></span></button>`;
    }).join('');

    let searchTimer;
    $('searchInput').addEventListener('input', event => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => changeFilters({search:event.target.value}), 140);
    });
    $('statusFilter').addEventListener('change', event => changeFilters({stage:event.target.value}));
    $('sortFilter').addEventListener('change', event => changeFilters({sort:event.target.value}));
    $('mobileStream').addEventListener('change', event => changeFilters({stream:event.target.value}));
    document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => changeFilters({view:button.dataset.view})));
    $('workstreams').addEventListener('click', event => {
      const button = event.target.closest('[data-stream]');
      if (button) changeFilters({stream:button.dataset.stream});
    });
    $('stageLegend').addEventListener('click', event => {
      const button = event.target.closest('[data-stage-filter]');
      if (button) { changeFilters({stage:button.dataset.stageFilter, view:'all'}); $('checklist').scrollIntoView({block:'start'}); }
    });
    document.querySelectorAll('[data-stat]').forEach(button => button.addEventListener('click', () => {
      resetFilters();
      if (button.dataset.stat !== 'all') changeFilters({stage:button.dataset.stat});
      $('checklist').scrollIntoView({block:'start'});
    }));
    $('focusCards').addEventListener('click', event => {
      const button = event.target.closest('[data-jump]');
      if (button) jumpTo(button.dataset.jump);
    });
    $('taskList').addEventListener('click', event => {
      const pin = event.target.closest('[data-pin]');
      if (pin) {
        event.preventDefault();
        event.stopPropagation();
        const id = pin.dataset.pin;
        if (watchlist.has(id)) watchlist.delete(id); else watchlist.add(id);
        try { localStorage.setItem(storageKey, JSON.stringify([...watchlist])); } catch { toast('Watchlist saved for this visit. Browser storage is unavailable.'); }
        render();
        $('taskList').querySelector(`[data-pin="${id}"]`)?.focus({preventScroll:true});
        return;
      }
      const copy = event.target.closest('[data-copy]');
      if (copy) copyText(`${location.origin}${location.pathname}#task-${encodeURIComponent(copy.dataset.copy)}`, 'Item link copied. Share this exact part of the project.');
    });
    $('loadMore').addEventListener('click', () => { state.limit += pageSize; render(); });
    $('resetFilters').addEventListener('click', resetFilters);
    $('emptyReset').addEventListener('click', resetFilters);
    $('shareView').addEventListener('click', () => copyText(`${location.origin}${viewUrl()}`, state.view === 'saved' ? 'Public filtered view copied. Personal bookmarks stay on your device.' : 'Filtered view copied. Ready to share.'));
    $('downloadCsv').addEventListener('click', exportCsv);
    document.addEventListener('keydown', event => {
      if (event.key === '/' && !event.ctrlKey && !event.metaKey && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { event.preventDefault(); $('searchInput').focus(); }
    });
    window.addEventListener('hashchange', () => {
      if (location.hash.startsWith('#task-')) jumpTo(decodeURIComponent(location.hash.slice(6)));
    });
    render();
    if (location.hash.startsWith('#task-')) jumpTo(decodeURIComponent(location.hash.slice(6)));
  }

  fetch('data.json', {cache:'no-cache'})
    .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
    .then(data => { if (!Array.isArray(data.items) || !data.items.length || !Array.isArray(data.stages) || !Array.isArray(data.streams)) throw new Error('Invalid project data'); project = data; initialise(); })
    .catch(error => {
      console.error('Project tracker could not load:', error);
      $('taskList').setAttribute('aria-busy', 'false');
      $('taskList').innerHTML = '<div class="empty-state"><h3>The development log couldn’t load.</h3><p>Please refresh the page to try again.</p><button class="outline-button" id="retryLoad" type="button">Try again</button></div>';
      $('resultsCount').textContent = 'Tracker data unavailable';
      $('retryLoad').addEventListener('click', () => location.reload());
    });
})();
