// layout.js — Estrutura (menu lateral + topo) e utilitários compartilhados do Inova+ Helpdesk
// Uso: a página coloca seu conteúdo em <div id="page" data-nav="tickets"> … </div>
//      e carrega este arquivo depois de auth.js / data.js / api.js.
// absprinter © 2025

'use strict';

(function () {

  // ── Utilitários (window.HD) ───────────────────────────────────────────────
  const SLA_HOURS = {
    'Crítica': { resp: 2,  res: 4  },
    'Alta':    { resp: 4,  res: 8  },
    'Média':   { resp: 8,  res: 24 },
    'Baixa':   { resp: 24, res: 72 },
  };

  const decoder = document.createElement('textarea');
  const decode = s => { decoder.innerHTML = String(s ?? ''); return decoder.value; };
  /** Texto seguro para innerHTML (decodifica o que o PHP já escapou e escapa de novo) */
  const text = s => decode(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const AVATAR_COLORS = ['#7c3aed', '#2563eb', '#0d9488', '#c026d3', '#ea580c', '#4f46e5', '#0891b2', '#be123c'];
  function hash(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }
  const initials = n => String(decode(n) || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');

  function avatar(name, size = '') {
    if (!name) return `<span class="avatar ${size ? 'avatar-' + size : ''}" style="background:#d0d5dd;color:#475467">?</span>`;
    return `<span class="avatar ${size ? 'avatar-' + size : ''}" style="background:${AVATAR_COLORS[hash(decode(name)) % AVATAR_COLORS.length]}" title="${text(name)}">${text(initials(name))}</span>`;
  }
  const person = (name, size = 'sm') =>
    name ? `<span class="person">${avatar(name, size)}<span>${text(name)}</span></span>` : '<span class="muted">Não atribuído</span>';

  const STATUS_CLASS = { 'Aberto': 'aberto', 'Em andamento': 'andamento', 'Resolvido': 'resolvido', 'Fechado': 'fechado' };
  const status = s => `<span class="status status-${STATUS_CLASS[s] || 'aberto'}">${text(s || 'Aberto')}</span>`;

  const PRIO_CLASS = { 'Crítica': 'critica', 'Alta': 'alta', 'Média': 'media', 'Baixa': 'baixa' };
  const prio = p => `<span class="prio prio-${PRIO_CLASS[p] || 'media'}"><span class="prio-bars"><i></i><i></i><i></i></span>${text(p || 'Média')}</span>`;

  const created = t => {
    const d = new Date(t?.created_at || (t?.created ? t.created + 'T09:00:00' : ''));
    return isNaN(d) ? null : d;
  };
  const updated = t => {
    const d = new Date(t?.updated_at || '');
    return isNaN(d) ? created(t) : d;
  };
  const isOpen = t => t && (t.status === 'Aberto' || t.status === 'Em andamento');

  function dur(ms) {
    const m = Math.round(Math.abs(ms) / 60000);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60), r = m % 60;
    if (h < 48) return r && h < 10 ? `${h}h ${r}min` : `${h}h`;
    return `${Math.round(h / 24)} dias`;
  }

  /**
   * SLA de resolução. Com data/hora de abertura (created_at) calcula o prazo real;
   * nos chamados antigos (sem hora) usa o percentual gravado no campo "sla".
   * → { state: ok|warn|breach|done, label, due, pct }
   */
  function sla(t) {
    const rule = SLA_HOURS[t?.priority] || SLA_HOURS['Média'];
    if (!isOpen(t)) return { state: 'done', label: t?.status === 'Fechado' ? 'Encerrado' : 'Cumprido', pct: 100 };
    if (t.created_at) {
      const c = created(t);
      const due = new Date(c.getTime() + rule.res * 3600e3);
      const left = due - Date.now();
      const pct = Math.max(0, Math.min(100, Math.round((left / (rule.res * 3600e3)) * 100)));
      if (left < 0) return { state: 'breach', label: `Violado há ${dur(left)}`, due, pct: 0 };
      return { state: pct <= 25 ? 'warn' : 'ok', label: `Vence em ${dur(left)}`, due, pct };
    }
    const pct = Number(t.sla ?? 100);
    if (pct <= 20) return { state: 'breach', label: `Crítico (${pct}%)`, pct };
    if (pct <= 50) return { state: 'warn', label: `Em risco (${pct}%)`, pct };
    return { state: 'ok', label: `No prazo (${pct}%)`, pct };
  }
  const SLA_ICON = { ok: 'fa-regular fa-clock', warn: 'fa-solid fa-hourglass-half', breach: 'fa-solid fa-circle-exclamation', done: 'fa-solid fa-check' };
  const slaHtml = t => { const s = sla(t); return `<span class="sla sla-${s.state}"><i class="${SLA_ICON[s.state]}"></i>${s.label}</span>`; };

  function rel(d) {
    if (!d) return '—';
    const s = Math.round((Date.now() - d.getTime()) / 1000);
    if (s < 60) return 'agora';
    if (s < 3600) return `há ${Math.round(s / 60)} min`;
    if (s < 86400) return `há ${Math.round(s / 3600)} h`;
    if (s < 7 * 86400) return `há ${Math.round(s / 86400)} d`;
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
  }
  const dt = d => (d ? d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

  function me() {
    try { return JSON.parse(localStorage.getItem('inova_user') || '{}').name || 'Usuário'; } catch { return 'Usuário'; }
  }
  const num = id => String(id || '').replace(/\D/g, '');
  const ticketUrl = id => `ticket.html?id=${num(id)}`;
  const tickets = () => (Array.isArray(window.TICKETS) ? window.TICKETS : []);
  const team = () => {
    const names = new Set((Array.isArray(window.TEAM) ? window.TEAM : []).map(m => decode(m.name)));
    tickets().forEach(t => t.assignee && names.add(decode(t.assignee)));
    names.add(me());
    return [...names].filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  };

  window.HD = { SLA_HOURS, decode, text, avatar, person, status, prio, sla, slaHtml, created, updated, isOpen, rel, dt, dur, me, num, ticketUrl, tickets, team, initials };

  // ── Estrutura da página ───────────────────────────────────────────────────
  const NAV = [
    { section: 'Atendimento' },
    { key: 'dashboard', href: 'dashboard.html',  icon: 'fa-solid fa-chart-simple', label: 'Visão geral' },
    { key: 'tickets',   href: 'tickets.html',    icon: 'fa-solid fa-inbox',        label: 'Tickets', count: 'open' },
    { key: 'mine',      href: 'tickets.html?view=mine', icon: 'fa-solid fa-user-check', label: 'Meus tickets', count: 'mine' },
    { key: 'new',       href: 'new-ticket.html', icon: 'fa-solid fa-plus',         label: 'Novo ticket' },
    { key: 'alerts',    href: 'alerts.html',     icon: 'fa-solid fa-triangle-exclamation', label: 'Alertas de SLA', count: 'alerts' },
    { section: 'Gestão' },
    { key: 'reports',   href: 'reports.html',    icon: 'fa-solid fa-chart-line',   label: 'Relatórios' },
    { key: 'team',      href: 'team.html',       icon: 'fa-solid fa-users',        label: 'Equipe' },
    { key: 'kb',        href: 'kb.html',         icon: 'fa-solid fa-book',         label: 'Base de conhecimento' },
    { key: 'chat',      href: 'chat.html',       icon: 'fa-regular fa-comments',   label: 'Conversas' },
  ];

  function mount() {
    const page = document.getElementById('page');
    if (!page || document.querySelector('.shell')) return;
    const active = page.dataset.nav || '';

    const nav = NAV.map(n => n.section
      ? `<div class="side-label">${n.section}</div>`
      : `<a class="side-link ${n.key === active ? 'active' : ''}" href="${n.href}" ${n.key === active ? 'aria-current="page"' : ''}>
           <i class="${n.icon}"></i><span>${n.label}</span>${n.count ? `<span class="side-count" data-count="${n.count}" hidden></span>` : ''}
         </a>`).join('');

    const shell = document.createElement('div');
    shell.className = 'shell';
    shell.innerHTML = `
      <aside class="sidebar" id="sidebar" aria-label="Menu principal">
        <div class="side-brand">
          <img src="favicon.svg" alt="" />
          <div><strong>Inova+</strong><span>Helpdesk</span></div>
        </div>
        <nav class="side-nav">${nav}</nav>
        <div class="side-user">
          <span class="avatar" id="sidebar-avatar">CG</span>
          <div class="who"><strong id="sidebar-name">Usuário</strong><span>Agente de suporte</span></div>
          <button type="button" title="Sair" aria-label="Sair" onclick="doLogout()"><i class="fa-solid fa-arrow-right-from-bracket"></i></button>
        </div>
      </aside>
      <div class="main">
        <header class="topbar">
          <button class="hamburger" type="button" aria-label="Abrir menu" onclick="toggleSidebar()"><i class="fa-solid fa-bars"></i></button>
          <form class="global-search" role="search" action="tickets.html">
            <i class="fa-solid fa-magnifying-glass"></i>
            <input type="search" name="q" id="global-search" placeholder="Buscar tickets por ID, assunto, solicitante, nº de série…" autocomplete="off" />
            <kbd>/</kbd>
          </form>
          <div class="topbar-actions">
            <span class="topbar-date" id="topbar-date"></span>
            <a class="btn btn-primary btn-sm btn-new" href="new-ticket.html"><i class="fa-solid fa-plus"></i><span>Novo ticket</span></a>
            <span class="avatar" id="topbar-avatar" title="Sua conta">CG</span>
          </div>
        </header>
        <div class="content" id="content"></div>
      </div>
      <div class="side-overlay hidden" id="sidebar-overlay" onclick="toggleSidebar()"></div>`;

    document.body.prepend(shell);
    shell.querySelector('#content').appendChild(page);
    page.hidden = false;

    // Pesquisa global: "/" foca a busca
    const search = shell.querySelector('#global-search');
    const q = new URLSearchParams(location.search).get('q');
    if (q) search.value = q;
    document.addEventListener('keydown', e => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (e.key === '/' && !['input', 'textarea', 'select'].includes(tag) && !e.target.isContentEditable) {
        e.preventDefault(); search.focus(); search.select();
      }
    });

    // Avatar com a cor do usuário
    const name = me();
    ['sidebar-avatar', 'topbar-avatar'].forEach(id => {
      const el = document.getElementById(id);
      el.style.background = AVATAR_COLORS[hash(name) % AVATAR_COLORS.length];
      el.textContent = initials(name);
    });

    updateCounts();
  }

  function updateCounts() {
    const list = tickets();
    const counts = {
      open: list.filter(isOpen).length,
      mine: list.filter(t => isOpen(t) && decode(t.assignee) === me()).length,
      alerts: list.filter(t => isOpen(t) && ['warn', 'breach'].includes(sla(t).state)).length,
    };
    document.querySelectorAll('[data-count]').forEach(el => {
      const v = counts[el.dataset.count] || 0;
      el.textContent = v;
      el.hidden = !v;
      el.classList.toggle('alert', el.dataset.count === 'alerts' && v > 0);
    });
  }
  HD.updateCounts = updateCounts;

  // auth.js preenche avatar/nome com as iniciais do login; reaplica a cor depois
  document.addEventListener('DOMContentLoaded', () => setTimeout(() => {
    const name = me();
    ['sidebar-avatar', 'topbar-avatar'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.background = AVATAR_COLORS[hash(name) % AVATAR_COLORS.length];
    });
  }, 0));

  mount();
})();
