// tickets.js — Fila de tickets (visualizações, filtros, ordenação, seleção e ações em lote)
// absprinter © 2025

'use strict';

(function () {
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const PRIO_RANK = { 'Crítica': 0, 'Alta': 1, 'Média': 2, 'Baixa': 3 };
  const STATUS_RANK = { 'Aberto': 0, 'Em andamento': 1, 'Resolvido': 2, 'Fechado': 3 };
  const SLA_RANK = { breach: 0, warn: 1, ok: 2, done: 3 };

  const VIEWS = [
    { key: 'mine',      icon: 'fa-solid fa-user-check',  label: 'Meus tickets', desc: 'Tickets não resolvidos atribuídos a você.',
      test: t => HD.isOpen(t) && HD.decode(t.assignee) === HD.me() },
    { key: 'queue',     icon: 'fa-solid fa-inbox',       label: 'Na fila', desc: 'Abertos que ainda ninguém assumiu — atenda pelo mais urgente.',
      test: t => t.status === 'Aberto', hot: true },
    { key: 'unresolved',icon: 'fa-regular fa-folder-open', label: 'Não resolvidos', desc: 'Todos os tickets abertos ou em andamento.',
      test: HD.isOpen },
    { key: 'sla',       icon: 'fa-solid fa-hourglass-half', label: 'SLA em risco', desc: 'Tickets que precisam de ação para cumprir o prazo.',
      test: t => HD.isOpen(t) && ['warn', 'breach'].includes(HD.sla(t).state), hot: true },
    { key: 'urgent',    icon: 'fa-solid fa-angles-up',   label: 'Alta e crítica', desc: 'Não resolvidos com prioridade Alta ou Crítica.',
      test: t => HD.isOpen(t) && (t.priority === 'Crítica' || t.priority === 'Alta') },
    { key: 'progress',  icon: 'fa-solid fa-spinner',     label: 'Em andamento', desc: 'Tickets sendo trabalhados agora.',
      test: t => t.status === 'Em andamento' },
    { key: 'recent',    icon: 'fa-regular fa-clock',     label: 'Atualizados', desc: 'Todos os tickets, do mais recente para o mais antigo.',
      test: () => true, sort: { key: 'updated', dir: -1 } },
    { key: 'resolved',  icon: 'fa-regular fa-circle-check', label: 'Resolvidos', desc: 'Aguardando confirmação ou encerramento.',
      test: t => t.status === 'Resolvido' },
    { key: 'closed',    icon: 'fa-solid fa-lock',        label: 'Fechados', desc: 'Tickets encerrados.',
      test: t => t.status === 'Fechado' },
    { key: 'all',       icon: 'fa-solid fa-list',        label: 'Todos os tickets', desc: 'Todos os tickets do sistema.',
      test: () => true },
  ];
  const CATS = ['Impressora', 'Suprimentos', 'TI', 'Rede', 'Outro'];

  const state = {
    view: params.get('view') || (params.get('q') ? 'all' : 'unresolved'),
    category: '',
    search: params.get('q') || '',
    priority: '',
    assignee: '',
    sort: { key: 'sla', dir: 1 },
    page: 1,
    size: 25,
    selected: new Set(),
  };
  const highlight = params.get('novo') ? '#' + params.get('novo').replace(/\D/g, '').padStart(4, '0') : null;
  let scrolled = false;
  let lastRows = [];

  const viewOf = k => VIEWS.find(v => v.key === k) || VIEWS[2];

  function sortValue(t, key) {
    switch (key) {
      case 'id':       return parseInt(HD.num(t.id), 10) || 0;
      case 'subject':  return HD.decode(t.subject).toLowerCase();
      case 'status':   return STATUS_RANK[t.status] ?? 9;
      case 'priority': return PRIO_RANK[t.priority] ?? 9;
      case 'assignee': return HD.decode(t.assignee || 'zzz').toLowerCase();
      case 'category': return HD.decode(t.category).toLowerCase();
      case 'sla':      { const s = HD.sla(t); return (SLA_RANK[s.state] * 1000) + (s.pct ?? 100) + (PRIO_RANK[t.priority] ?? 9) / 10; }
      case 'updated':  return (HD.updated(t) || new Date(0)).getTime();
      default:         return 0;
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function renderViews() {
    const all = HD.tickets();
    $('view-list').innerHTML = VIEWS.map(v => {
      const n = all.filter(v.test).length;
      const active = !state.category && state.view === v.key;
      return `<button class="view ${active ? 'active' : ''}" data-view="${v.key}" type="button">
        <i class="${v.icon}"></i><span>${v.label}</span><span class="n ${v.hot && n ? 'hot' : ''}">${n}</span></button>`;
    }).join('');
    $('cat-list').innerHTML = CATS.map(c => {
      const n = all.filter(t => HD.isOpen(t) && HD.decode(t.category) === c).length;
      return `<button class="view ${state.category === c ? 'active' : ''}" data-cat="${c}" type="button">
        <i class="fa-solid fa-tag"></i><span>${c}</span><span class="n">${n}</span></button>`;
    }).join('');
  }

  function renderAssignees() {
    const sel = $('f-assignee');
    const cur = sel.value;
    sel.innerHTML = '<option value="">Todos os responsáveis</option>' +
      HD.team().map(n => `<option ${n === cur ? 'selected' : ''}>${HD.text(n)}</option>`).join('');
  }

  function currentRows() {
    const v = viewOf(state.view);
    const q = state.search.trim().toLowerCase();
    return HD.tickets().filter(t =>
      (state.category ? HD.isOpen(t) && HD.decode(t.category) === state.category : v.test(t)) &&
      (!state.priority || t.priority === state.priority) &&
      (!state.assignee || HD.decode(t.assignee) === state.assignee) &&
      (!q || [t.id, t.subject, t.requester, t.assignee, t.serial, t.model, t.category, t.dept, t.desc]
              .some(x => HD.decode(x).toLowerCase().includes(q))))
      .sort((a, b) => {
        const A = sortValue(a, state.sort.key), B = sortValue(b, state.sort.key);
        if (A < B) return -1 * state.sort.dir;
        if (A > B) return 1 * state.sort.dir;
        return (parseInt(HD.num(b.id), 10) || 0) - (parseInt(HD.num(a.id), 10) || 0);
      });
  }

  function renderTable() {
    const rows = currentRows();
    lastRows = rows;
    const pages = Math.max(1, Math.ceil(rows.length / state.size));
    if (state.page > pages) state.page = pages;
    if (highlight && !scrolled) {
      const idx = rows.findIndex(t => t.id === highlight);
      if (idx >= 0) state.page = Math.floor(idx / state.size) + 1;
    }
    const slice = rows.slice((state.page - 1) * state.size, state.page * state.size);

    const v = viewOf(state.view);
    $('view-title').textContent = state.category ? `${state.category} — não resolvidos` : v.label;
    $('view-desc').textContent = state.category ? `Tickets abertos ou em andamento da categoria ${state.category}.` : v.desc;

    // Cabeçalhos de ordenação
    document.querySelectorAll('#tk-table th.sortable').forEach(th => {
      const on = th.dataset.sort === state.sort.key;
      th.classList.toggle('sorted', on);
      th.setAttribute('aria-sort', on ? (state.sort.dir === 1 ? 'ascending' : 'descending') : 'none');
      th.querySelector('.sort-ind').textContent = on && state.sort.dir === -1 ? '▲' : '▼';
    });

    const body = $('tk-body');
    if (!slice.length) {
      body.innerHTML = `<tr><td colspan="8"><div class="empty"><i class="fa-regular fa-folder-open"></i>
        <strong>Nenhum ticket nesta visualização</strong>${state.search || state.priority || state.assignee ? 'Tente limpar os filtros.' : 'Tudo em dia por aqui.'}</div></td></tr>`;
    } else {
      body.innerHTML = slice.map(t => {
        const isNewT = (Date.now() - (HD.created(t)?.getTime() || 0)) < 864e5;
        const sel = state.selected.has(t.id);
        const att = (t.attachments || []).length, com = (t.comments || []).length;
        return `<tr data-id="${HD.text(t.id)}" class="${sel ? 'selected' : ''} ${t.id === highlight ? 'flash' : ''} ${t.status === 'Aberto' ? 't-unread' : ''}">
          <td class="col-check"><input type="checkbox" class="checkbox row-check" ${sel ? 'checked' : ''} aria-label="Selecionar ${HD.text(t.id)}" /></td>
          <td class="t-id mono">${HD.text(t.id)}</td>
          <td>
            <a class="t-subject" href="${HD.ticketUrl(t.id)}" title="${HD.text(t.subject)}">${HD.text(t.subject)}</a>
            <div class="t-sub">
              ${HD.text(t.requester || '—')}<span class="dot-sep"></span>${HD.text(t.category || '—')}
              ${isNewT ? '<span class="tag tag-new">Novo</span>' : ''}
              ${t._pending ? '<span class="tag tag-offline">Offline</span>' : ''}
              ${att ? `<span title="${att} anexo(s)"><i class="fa-solid fa-paperclip"></i> ${att}</span>` : ''}
              ${com ? `<span title="${com} comentário(s)"><i class="fa-regular fa-comment"></i> ${com}</span>` : ''}
            </div>
          </td>
          <td>${HD.status(t.status)}</td>
          <td class="col-prio">${HD.prio(t.priority)}</td>
          <td class="col-assignee">${HD.person(t.assignee)}</td>
          <td>${HD.slaHtml(t)}</td>
          <td class="col-upd muted" title="${HD.dt(HD.updated(t))}">${HD.rel(HD.updated(t))}</td>
        </tr>`;
      }).join('');
    }

    const from = rows.length ? (state.page - 1) * state.size + 1 : 0;
    $('foot-info').textContent = `${from}–${Math.min(state.page * state.size, rows.length)} de ${rows.length} ticket${rows.length !== 1 ? 's' : ''}`;
    $('pg-label').textContent = `${state.page} / ${pages}`;
    $('pg-prev').disabled = state.page <= 1;
    $('pg-next').disabled = state.page >= pages;

    renderBulk(slice);

    if (highlight && !scrolled) {
      const row = body.querySelector(`tr[data-id="${CSS.escape(highlight)}"]`);
      if (row) { row.scrollIntoView({ block: 'center' }); scrolled = true; }
    }
  }

  function renderBulk(slice) {
    const n = state.selected.size;
    $('bulk').classList.toggle('show', n > 0);
    $('bulk-count').textContent = `${n} selecionado${n !== 1 ? 's' : ''}`;
    const all = $('check-all');
    const onPage = (slice || []).map(t => t.id);
    const selOnPage = onPage.filter(id => state.selected.has(id)).length;
    all.checked = onPage.length > 0 && selOnPage === onPage.length;
    all.indeterminate = selOnPage > 0 && selOnPage < onPage.length;
  }

  function renderPage() {
    renderViews();
    renderAssignees();
    renderTable();
    HD.updateCounts();
  }
  window.renderPage = renderPage;

  // ── Dados ─────────────────────────────────────────────────────────────────
  async function refresh(manual) {
    const icon = $('btn-refresh').querySelector('i');
    icon.classList.add('fa-spin');
    try {
      await TicketAPI.syncPending();
      await TicketAPI.list();
      $('sync-label').innerHTML = `<i class="fa-solid fa-circle" style="color:#12b76a;font-size:7px"></i> Atualizado às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    } catch {
      $('sync-label').innerHTML = '<i class="fa-solid fa-circle" style="color:#f79009;font-size:7px"></i> Offline — dados locais';
      if (manual) showToast('Servidor indisponível. Mostrando dados salvos neste navegador.', 'error');
    } finally {
      renderPage();
      setTimeout(() => icon.classList.remove('fa-spin'), 300);
    }
  }
  window.refreshTickets = refresh;

  // ── Ações em lote ─────────────────────────────────────────────────────────
  async function bulk(action) {
    if (action === 'clear') { state.selected.clear(); renderTable(); return; }
    const ids = [...state.selected];
    const labels = { attend: 'atribuir a você', resolve: 'marcar como resolvidos', close: 'fechar' };
    if (!confirm(`Deseja ${labels[action]} ${ids.length} ticket(s)?`)) return;
    const patch = {
      attend:  { status: 'Em andamento', assignee: HD.me() },
      resolve: { status: 'Resolvido' },
      close:   { status: 'Fechado', sla: 100 },
    }[action];
    let ok = 0, offline = 0;
    for (const id of ids) {
      try { await TicketAPI.update(id, patch); ok++; }
      catch (e) { if (e.offline) { _localTicketUpdate(id, patch); offline++; } }
    }
    state.selected.clear();
    renderPage();
    showToast(offline ? `${ok + offline} ticket(s) atualizados (${offline} offline).` : `${ok} ticket(s) atualizados.`, 'success');
  }

  function exportCsv() {
    const cols = ['ID', 'Assunto', 'Status', 'Prioridade', 'Responsável', 'Solicitante', 'Categoria', 'Departamento', 'SLA', 'Criado', 'Atualizado'];
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = lastRows.map(t => [t.id, t.subject, t.status, t.priority, t.assignee, t.requester, t.category, t.dept,
      HD.sla(t).label, HD.dt(HD.created(t)), HD.dt(HD.updated(t))].map(v => q(HD.decode(v))).join(';'));
    const blob = new Blob(['﻿' + [cols.join(';'), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `tickets-${state.view}-${new Date().toISOString().slice(0, 10)}.csv` });
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ── Eventos ───────────────────────────────────────────────────────────────
  function setView(view, category = '') {
    state.view = view; state.category = category; state.page = 1; state.selected.clear();
    const v = viewOf(view);
    if (v.sort && !category) state.sort = { ...v.sort };
    const url = new URL(location.href);
    url.searchParams.set('view', view); url.searchParams.delete('novo'); url.searchParams.delete('q');
    history.replaceState(null, '', url);
    $('views').classList.remove('open');
    renderViews(); renderTable();
  }

  $('views').addEventListener('click', e => {
    const b = e.target.closest('.view');
    if (!b) return;
    if (b.dataset.cat) setView('unresolved', b.dataset.cat);
    else setView(b.dataset.view);
  });

  $('f-search').value = state.search;
  $('f-search').addEventListener('input', e => { state.search = e.target.value; state.page = 1; renderTable(); });
  $('f-priority').addEventListener('change', e => { state.priority = e.target.value; state.page = 1; renderTable(); });
  $('f-assignee').addEventListener('change', e => { state.assignee = e.target.value; state.page = 1; renderTable(); });
  $('f-clear').addEventListener('click', () => {
    state.search = state.priority = state.assignee = '';
    $('f-search').value = $('f-priority').value = $('f-assignee').value = '';
    const gs = document.getElementById('global-search'); if (gs) gs.value = '';
    state.page = 1; renderTable();
  });

  document.querySelector('#tk-table thead').addEventListener('click', e => {
    const th = e.target.closest('th.sortable');
    if (!th) return;
    const key = th.dataset.sort;
    state.sort = state.sort.key === key ? { key, dir: -state.sort.dir } : { key, dir: key === 'updated' || key === 'id' ? -1 : 1 };
    renderTable();
  });

  $('check-all').addEventListener('change', e => {
    const onPage = lastRows.slice((state.page - 1) * state.size, state.page * state.size);
    onPage.forEach(t => (e.target.checked ? state.selected.add(t.id) : state.selected.delete(t.id)));
    renderTable();
  });

  $('tk-body').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const id = tr.dataset.id;
    if (e.target.classList.contains('row-check')) {
      e.target.checked ? state.selected.add(id) : state.selected.delete(id);
      tr.classList.toggle('selected', e.target.checked);
      renderBulk(lastRows.slice((state.page - 1) * state.size, state.page * state.size));
      return;
    }
    if (e.target.closest('a')) return; // link do assunto
    if (e.ctrlKey || e.metaKey) window.open(HD.ticketUrl(id), '_blank');
    else location.href = HD.ticketUrl(id);
  });

  $('bulk').addEventListener('click', e => { const b = e.target.closest('[data-bulk]'); if (b) bulk(b.dataset.bulk); });
  $('page-size').addEventListener('change', e => { state.size = +e.target.value; state.page = 1; renderTable(); });
  $('pg-prev').addEventListener('click', () => { state.page--; renderTable(); });
  $('pg-next').addEventListener('click', () => { state.page++; renderTable(); });
  $('btn-refresh').addEventListener('click', () => refresh(true));
  $('btn-export').addEventListener('click', exportCsv);
  window.addEventListener('storage', e => { if (e.key === 'inova_local_tickets') refresh(); });

  // ── Init ──────────────────────────────────────────────────────────────────
  window.addEventListener('load', () => {
    checkAuth();
    renderPage();
    refresh();
    setInterval(() => refresh(), 30000);
    setInterval(renderTable, 60000); // atualiza contagem regressiva do SLA
  });
})();
