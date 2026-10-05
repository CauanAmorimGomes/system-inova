// dashboard.js — Visão geral do helpdesk (todos os números vêm dos tickets reais)
// absprinter © 2025

'use strict';

(function () {
  const $ = id => document.getElementById(id);
  const H = HD.text;
  const PRIOS = ['Crítica', 'Alta', 'Média', 'Baixa'];
  const PRIO_COLOR = { 'Crítica': '#d92d20', 'Alta': '#ea580c', 'Média': '#2563eb', 'Baixa': '#98a2b3' };

  function greet() {
    const h = new Date().getHours();
    const first = HD.me().split(' ')[0];
    $('hello').textContent = `${h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'}, ${first}`;
  }

  function renderKpis(all) {
    const open = all.filter(HD.isOpen);
    const queue = all.filter(t => t.status === 'Aberto');
    const risk = open.filter(t => HD.sla(t).state === 'warn');
    const breach = open.filter(t => HD.sla(t).state === 'breach');
    const done = all.filter(t => !HD.isOpen(t));
    const crit = open.filter(t => t.priority === 'Crítica').length;
    const oldestQueue = queue.map(HD.created).filter(Boolean).sort((a, b) => a - b)[0];

    $('k-open').textContent = open.length;
    $('k-open-foot').innerHTML = `<strong>${all.filter(t => t.status === 'Em andamento').length}</strong> em andamento · <strong>${crit}</strong> crítico${crit !== 1 ? 's' : ''}`;
    $('k-queue').textContent = queue.length;
    $('k-queue-foot').innerHTML = oldestQueue ? `Mais antigo: <strong>${HD.rel(oldestQueue)}</strong>` : 'Fila vazia';
    $('k-sla').textContent = risk.length + breach.length;
    $('k-sla-foot').innerHTML = `<strong>${breach.length}</strong> violado${breach.length !== 1 ? 's' : ''} · <strong>${risk.length}</strong> em risco`;
    $('k-sla-card').classList.toggle('is-danger', breach.length > 0);
    $('k-sla-card').classList.toggle('is-warn', !breach.length);
    $('k-done').textContent = done.length;
    const rate = all.length ? Math.round((done.length / all.length) * 100) : 0;
    $('k-done-foot').innerHTML = `<strong>${rate}%</strong> do total de ${all.length} tickets`;

    $('hello-sub').textContent = queue.length
      ? `${queue.length} ticket${queue.length !== 1 ? 's' : ''} aguardando atendimento na fila.`
      : 'Nenhum ticket aguardando na fila. Bom trabalho!';
  }

  function renderMine(all) {
    const me = HD.me();
    const mine = all.filter(t => HD.isOpen(t) && HD.decode(t.assignee) === me)
      .sort((a, b) => (HD.sla(a).pct ?? 100) - (HD.sla(b).pct ?? 100));
    $('mine-count').textContent = mine.length;
    $('mine-body').innerHTML = mine.length ? mine.slice(0, 6).map(t => `
      <tr onclick="location.href='${HD.ticketUrl(t.id)}'">
        <td><a class="t-subject" href="${HD.ticketUrl(t.id)}" style="max-width:300px">${H(t.subject)}</a>
            <div class="t-sub"><span class="mono">${H(t.id)}</span><span class="dot-sep"></span>${H(t.requester)}</div></td>
        <td>${HD.status(t.status)}</td>
        <td>${HD.prio(t.priority)}</td>
        <td>${HD.slaHtml(t)}</td>
      </tr>`).join('')
      : `<tr><td colspan="4"><div class="empty" style="padding:28px"><i class="fa-regular fa-face-smile"></i><strong>Nada atribuído a você</strong>Pegue um ticket da <a href="tickets.html?view=queue">fila</a>.</div></td></tr>`;
  }

  function renderRisk(all) {
    const list = all.filter(t => HD.isOpen(t) && (['warn', 'breach'].includes(HD.sla(t).state) || (t.status === 'Aberto' && t.priority === 'Crítica')))
      .sort((a, b) => (HD.sla(a).pct ?? 100) - (HD.sla(b).pct ?? 100)).slice(0, 6);
    $('risk-list').innerHTML = list.length ? list.map(t => `
      <a class="list-row" href="${HD.ticketUrl(t.id)}">
        <div class="grow">
          <div class="list-title">${H(t.subject)}</div>
          <div class="list-meta"><span class="mono">${H(t.id)}</span><span class="dot-sep"></span>${HD.prio(t.priority)}<span class="dot-sep"></span>${H(t.assignee || 'Sem responsável')}</div>
        </div>
        ${HD.slaHtml(t)}
      </a>`).join('')
      : '<div class="empty" style="padding:28px"><i class="fa-regular fa-circle-check" style="color:var(--ok)"></i><strong>Tudo dentro do prazo</strong>Nenhum ticket com SLA em risco.</div>';
  }

  function renderVolume(all) {
    const days = [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      days.push({ d, n: 0 });
    }
    all.forEach(t => {
      const c = HD.created(t);
      if (!c) return;
      const k = new Date(c); k.setHours(0, 0, 0, 0);
      const slot = days.find(x => x.d.getTime() === k.getTime());
      if (slot) slot.n++;
    });
    const total = days.reduce((s, x) => s + x.n, 0);
    const max = Math.max(4, ...days.map(x => x.n));
    const top = Math.ceil(max / 4) * 4;
    const ticks = [top, top * 0.75, top * 0.5, top * 0.25, 0];

    $('vol-total').textContent = `${total} ticket${total !== 1 ? 's' : ''} no período`;
    $('vol-chart').innerHTML = `
      <div class="chart-y">${ticks.map(v => `<span>${Math.round(v)}</span>`).join('')}</div>
      <div class="chart-plot">
        <div class="grid-area">${ticks.slice(0, -1).map(v => `<div class="grid-line" style="bottom:${(v / top) * 100}%"></div>`).join('')}</div>
        ${days.map((x, i) => {
          const label = x.d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
          const wd = x.d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
          const showX = i % 2 === 1 || i === days.length - 1;
          return `<div class="col ${i === days.length - 1 ? 'today' : ''}" tabindex="0" aria-label="${label}: ${x.n} tickets">
            <div class="bar" style="height:${(x.n / top) * 100}%"></div>
            <span class="tip">${wd}, ${label}: <b>${x.n}</b> ticket${x.n !== 1 ? 's' : ''}</span>
            ${showX ? `<span class="x">${i === days.length - 1 ? 'Hoje' : label}</span>` : ''}
          </div>`;
        }).join('')}
      </div>`;
    $('vol-note').textContent = total ? '' : 'Nenhum ticket aberto nos últimos 14 dias.';
  }

  function bars(el, rows, colorOf) {
    const max = Math.max(1, ...rows.map(r => r.n));
    el.innerHTML = rows.map(r => `
      <div class="bar-row" title="${H(r.label)}: ${r.n}">
        <span class="name">${H(r.label)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${(r.n / max) * 100}%;${colorOf ? `background:${colorOf(r.label)}` : ''}"></div></div>
        <span class="val">${r.n}</span>
      </div>`).join('') || '<p class="muted">Sem dados.</p>';
  }

  function renderBreakdowns(all) {
    const open = all.filter(HD.isOpen);
    bars($('prio-bars'), PRIOS.map(p => ({ label: p, n: open.filter(t => t.priority === p).length })), p => PRIO_COLOR[p]);

    const cats = {};
    open.forEach(t => { const c = HD.decode(t.category) || 'Outro'; cats[c] = (cats[c] || 0) + 1; });
    bars($('cat-bars'), Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([label, n]) => ({ label, n })));
  }

  function renderTeam(all) {
    const people = {};
    all.forEach(t => {
      const n = HD.decode(t.assignee);
      if (!n) return;
      people[n] = people[n] || { open: 0, prog: 0, done: 0 };
      if (HD.isOpen(t)) people[n].open++;
      if (t.status === 'Em andamento') people[n].prog++;
      if (!HD.isOpen(t)) people[n].done++;
    });
    const rows = Object.entries(people).sort((a, b) => b[1].open - a[1].open);
    const max = Math.max(1, ...rows.map(([, v]) => v.open));
    $('team-body').innerHTML = rows.map(([name, v]) => `
      <tr>
        <td>${HD.person(name)}</td>
        <td class="num"><a href="tickets.html?view=unresolved&q=${encodeURIComponent(name)}">${v.open}</a></td>
        <td class="num">${v.prog}</td>
        <td class="num">${v.done}</td>
        <td><div class="load"><div class="bar-track"><div class="bar-fill" style="width:${(v.open / max) * 100}%"></div></div></div></td>
      </tr>`).join('') || '<tr><td colspan="5" class="muted">Sem dados.</td></tr>';
  }

  function renderPage() {
    const all = HD.tickets();
    greet();
    renderKpis(all);
    renderMine(all);
    renderRisk(all);
    renderVolume(all);
    renderBreakdowns(all);
    renderTeam(all);
    HD.updateCounts();
  }
  window.renderPage = renderPage;

  async function refresh() {
    try {
      await TicketAPI.list();
      $('offline-banner').innerHTML = '';
      $('sync-label').textContent = `Atualizado às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    } catch {
      $('sync-label').textContent = 'Offline';
      $('offline-banner').innerHTML = `<div class="banner banner-warn"><i class="fa-solid fa-plug-circle-xmark"></i>
        <div><strong>Servidor indisponível.</strong> Mostrando os dados salvos neste navegador. Inicie o sistema pelo <b>iniciar-servidor.bat</b> para sincronizar.</div></div>`;
    }
    renderPage();
  }

  window.addEventListener('load', () => {
    checkAuth();
    renderPage();
    refresh();
    setInterval(refresh, 60000);
  });
})();
