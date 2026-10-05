// ticket.js — Página de detalhe do ticket (conversa, nota interna, propriedades, SLA)
// absprinter © 2025

'use strict';

(function () {
  const $ = id => document.getElementById(id);
  const raw = new URLSearchParams(location.search).get('id') || '';
  const ID = '#' + raw.replace(/\D/g, '').padStart(4, '0');

  let ticket = null;
  let mode = 'public';
  let saving = false;
  let lastSnapshot = '';

  const H = HD.text;
  const fileUrl = rel => (rel ? String(rel).replace(/^\/+/, '') : null);

  // ── Carregar ──────────────────────────────────────────────────────────────
  async function load() {
    try {
      const t = await TicketAPI.get(ID);
      if (t && t.id) {
        ticket = t;
        const i = (window.TICKETS || []).findIndex(x => x.id === t.id);
        if (i >= 0) window.TICKETS[i] = t;
      }
    } catch (e) {
      if (!e.offline && e.status === 404) ticket = null;
      else ticket = (window.TICKETS || []).find(x => x.id === ID) || ticket; // offline: usa a cópia local
    }
    render();
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function render() {
    $('loading').hidden = true;
    if (!ticket) {
      $('ticket-view').hidden = true;
      $('not-found').hidden = false;
      $('nf-msg').textContent = `O ticket ${ID} não existe ou o servidor está indisponível.`;
      return;
    }
    const snap = JSON.stringify(ticket);
    const changed = snap !== lastSnapshot;
    lastSnapshot = snap;

    $('not-found').hidden = true;
    $('ticket-view').hidden = false;
    const t = ticket;
    document.title = `${HD.decode(t.id)} ${HD.decode(t.subject)} · Inova+ Helpdesk`;

    $('bc-id').textContent = HD.decode(t.id);
    $('t-subject').textContent = HD.decode(t.subject);
    $('t-meta').innerHTML = `
      ${HD.status(t.status)} ${HD.prio(t.priority)}
      <span class="dot-sep"></span><span><i class="fa-solid fa-tag"></i> ${H(t.category)}</span>
      <span class="dot-sep"></span><span>Aberto ${HD.rel(HD.created(t))} por ${H(t.requester)}</span>
      ${t._pending ? '<span class="tag tag-offline">Salvo offline</span>' : ''}`;

    // Ações rápidas
    const actions = [];
    if (t.status === 'Aberto' || (HD.isOpen(t) && HD.decode(t.assignee) !== HD.me()))
      actions.push(`<button class="btn btn-sm btn-primary" data-act="attend"><i class="fa-solid fa-headset"></i> ${t.status === 'Aberto' ? 'Atender' : 'Assumir'}</button>`);
    if (HD.isOpen(t)) actions.push('<button class="btn btn-sm btn-success" data-act="resolve"><i class="fa-solid fa-check"></i> Resolver</button>');
    if (t.status === 'Resolvido') actions.push('<button class="btn btn-sm" data-act="reopen"><i class="fa-solid fa-rotate-left"></i> Reabrir</button>');
    if (t.status !== 'Fechado') actions.push('<button class="btn btn-sm btn-danger" data-act="close"><i class="fa-solid fa-lock"></i> Fechar</button>');
    $('t-actions').innerHTML = actions.join('');

    if (changed) renderThread();
    renderSide();
    $('composer').hidden = t.status === 'Fechado';
  }

  function renderThread() {
    const t = ticket;
    const items = [];

    // Mensagem de abertura (descrição)
    const atts = (t.attachments || []).map(a => {
      const url = fileUrl(a.url);
      const isImg = String(a.type || '').startsWith('image/');
      const thumb = isImg && url
        ? `<span class="thumb" style="background-image:url('${H(url)}')"></span>`
        : `<span class="thumb"><i class="fa-solid ${isImg ? 'fa-image' : 'fa-file-pdf'}"></i></span>`;
      const size = a.size ? ` · ${(a.size / 1024 < 1024 ? Math.round(a.size / 1024) + ' KB' : (a.size / 1048576).toFixed(1) + ' MB')}` : '';
      return url
        ? `<a class="att" href="${H(url)}" target="_blank" rel="noopener">${thumb}<span>${H(a.name)}<br><small class="muted">${size.slice(3) || 'Abrir'}</small></span></a>`
        : `<span class="att" title="Arquivo não enviado (criado offline)">${thumb}<span>${H(a.name)}<br><small class="muted">não enviado</small></span></span>`;
    }).join('');

    items.push(`
      <div class="msg">
        ${HD.avatar(t.requester)}
        <div class="msg-card origin">
          <div class="msg-head"><strong>${H(t.requester)}</strong><span class="muted">abriu o ticket</span>
            <span class="when" title="${HD.dt(HD.created(t))}">${HD.dt(HD.created(t))}</span></div>
          <div class="msg-body">${H(t.desc)}</div>
          ${atts ? `<div class="atts">${atts}</div>` : ''}
        </div>
      </div>`);

    items.push(`<div class="event"><i class="fa-solid fa-user-tag"></i> Atribuído a <strong>${H(t.assignee || '—')}</strong> · prioridade ${H(t.priority)}</div>`);

    (t.comments || []).forEach(c => {
      const when = c.at ? HD.dt(new Date(c.at)) : (c.time || '');
      items.push(`
        <div class="msg">
          ${HD.avatar(c.author)}
          <div class="msg-card ${c.internal ? 'internal' : ''}">
            <div class="msg-head"><strong>${H(c.author)}</strong>
              ${c.internal ? '<span class="tag tag-internal"><i class="fa-solid fa-lock"></i> Nota interna</span>' : ''}
              <span class="when">${H(when)}</span></div>
            <div class="msg-body">${H(c.text)}</div>
          </div>
        </div>`);
    });

    if (t.status === 'Resolvido' || t.status === 'Fechado') {
      const when = t.resolved_at ? ` em ${HD.dt(new Date(t.resolved_at))}` : '';
      items.push(`<div class="event"><i class="fa-solid fa-check" style="background:var(--ok-bg);color:var(--ok)"></i> Ticket ${t.status === 'Fechado' ? 'fechado' : 'resolvido'}${when}</div>`);
    }

    const thread = $('thread');
    const atBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
    thread.innerHTML = items.join('');
    if (atBottom || !thread.dataset.init) { thread.scrollTop = thread.scrollHeight; thread.dataset.init = '1'; }
  }

  function renderSide() {
    const t = ticket;
    $('t-requester').innerHTML = `${HD.avatar(t.requester, 'lg')}<div><strong>${H(t.requester)}</strong><span>${H(t.dept || '—')}</span></div>`;
    $('t-contact').innerHTML = `
      <dt>Contato</dt><dd>${t.contact ? H(t.contact) : '<span class="muted">—</span>'}</dd>
      <dt>Local</dt><dd>${t.location ? H(t.location) : '<span class="muted">—</span>'}</dd>`;

    // Propriedades (não sobrescreve enquanto o usuário edita)
    if (!$('btn-save').dataset.dirty) {
      const team = HD.team();
      const cur = HD.decode(t.assignee);
      if (cur && !team.includes(cur)) team.unshift(cur);
      $('p-assignee').innerHTML = team.map(n => `<option ${n === cur ? 'selected' : ''}>${H(n)}</option>`).join('');
      $('p-status').value = t.status;
      $('p-priority').value = t.priority;
      $('p-category').value = HD.decode(t.category);
      $('p-dept').value = HD.decode(t.dept) || 'TI';
    }

    // SLA
    const s = HD.sla(t);
    const rule = HD.SLA_HOURS[t.priority] || HD.SLA_HOURS['Média'];
    const c = HD.created(t);
    const color = { ok: '#12b76a', warn: '#f79009', breach: '#f04438', done: '#12b76a' }[s.state];
    const firstReply = (t.comments || []).find(x => !x.internal && x.author !== t.requester);
    $('t-sla').innerHTML = `
      <div class="sla-line"><span class="k">Resolução</span>${HD.slaHtml(t)}</div>
      <div class="progress" title="${s.pct ?? 100}% do prazo restante"><i style="width:${s.state === 'done' ? 100 : (s.pct ?? 100)}%;background:${color}"></i></div>
      ${t.created_at ? `<div class="sla-line"><span class="k">Prazo de resolução</span><span>${HD.dt(new Date(c.getTime() + rule.res * 3600e3))}</span></div>` : ''}
      <div class="sla-line"><span class="k">1ª resposta (${rule.resp}h)</span>${firstReply
        ? '<span class="sla sla-done"><i class="fa-solid fa-check"></i>Respondido</span>'
        : HD.isOpen(t) ? '<span class="sla sla-warn"><i class="fa-regular fa-clock"></i>Aguardando</span>' : '<span class="muted">—</span>'}</div>
      <div class="sla-line"><span class="k">Política</span><span>${H(t.priority)}: ${rule.resp}h / ${rule.res}h</span></div>`;

    // Equipamento
    const hasEquip = t.model || t.serial;
    $('sec-equip').hidden = !hasEquip;
    if (hasEquip) $('t-equip').innerHTML = `
      <dt>Modelo</dt><dd>${t.model ? H(t.model) : '—'}</dd>
      <dt>Nº de série</dt><dd class="mono">${t.serial ? H(t.serial) : '—'}</dd>`;

    $('t-details').innerHTML = `
      <dt>ID</dt><dd class="mono">${H(t.id)}</dd>
      <dt>Criado</dt><dd>${HD.dt(c)}</dd>
      <dt>Atualizado</dt><dd>${HD.rel(HD.updated(t))}</dd>
      <dt>Comentários</dt><dd>${(t.comments || []).length}</dd>
      <dt>Anexos</dt><dd>${(t.attachments || []).length}</dd>`;
  }

  // ── Ações ─────────────────────────────────────────────────────────────────
  async function update(patch, okMsg) {
    try {
      ticket = await TicketAPI.update(ticket.id, patch);
    } catch (e) {
      if (!e.offline) return false;
      _localTicketUpdate(ticket.id, patch);
      ticket = { ...ticket, ...patch, updated_at: new Date().toISOString() };
    }
    lastSnapshot = '';
    render();
    HD.updateCounts();
    if (okMsg) showToast(okMsg, 'success');
    return true;
  }

  $('t-actions').addEventListener('click', async e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'attend') await update({ status: 'Em andamento', assignee: HD.me() }, `Você assumiu o ticket ${HD.decode(ticket.id)}.`);
    if (act === 'resolve') await update({ status: 'Resolvido' }, 'Ticket marcado como resolvido.');
    if (act === 'reopen') await update({ status: 'Em andamento' }, 'Ticket reaberto.');
    if (act === 'close' && confirm(`Fechar o ticket ${HD.decode(ticket.id)}? Ele não poderá receber novas respostas.`))
      await update({ status: 'Fechado', sla: 100 }, 'Ticket fechado.');
  });

  // Propriedades
  const propIds = ['p-assignee', 'p-status', 'p-priority', 'p-category', 'p-dept'];
  propIds.forEach(id => $(id).addEventListener('change', () => {
    $('btn-save').disabled = false;
    $('btn-save').dataset.dirty = '1';
  }));
  $('props').addEventListener('submit', async e => {
    e.preventDefault();
    if (saving) return;
    saving = true;
    const btn = $('btn-save');
    btn.classList.add('loading');
    const patch = {
      assignee: $('p-assignee').value, status: $('p-status').value, priority: $('p-priority').value,
      category: $('p-category').value, dept: $('p-dept').value,
    };
    delete btn.dataset.dirty;
    await update(patch, 'Alterações salvas.');
    btn.classList.remove('loading');
    btn.disabled = true;
    saving = false;
  });

  // Composer
  document.querySelectorAll('#composer .tab').forEach(tab => tab.addEventListener('click', () => {
    mode = tab.dataset.mode;
    document.querySelectorAll('#composer .tab').forEach(x => {
      x.classList.toggle('active', x === tab);
      x.setAttribute('aria-selected', String(x === tab));
    });
    $('composer').classList.toggle('internal', mode === 'internal');
    $('reply-text').placeholder = mode === 'internal'
      ? 'Nota interna — visível apenas para a equipe de suporte…'
      : 'Escreva uma resposta para o solicitante…';
    $('reply-text').focus();
  }));

  $('macro').addEventListener('change', e => {
    if (!e.target.value) return;
    const ta = $('reply-text');
    ta.value = (ta.value ? ta.value.trimEnd() + '\n\n' : '') + e.target.value;
    e.target.value = '';
    ta.focus();
  });

  $('reply-text').addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); $('composer').requestSubmit(); }
  });

  $('composer').addEventListener('submit', async e => {
    e.preventDefault();
    const text = $('reply-text').value.trim();
    if (!text) { $('reply-text').focus(); return; }
    const btn = $('btn-send');
    btn.classList.add('loading'); btn.disabled = true;
    const internal = mode === 'internal';
    try {
      await TicketAPI.reply(ticket.id, text, HD.me(), internal);
    } catch (err) {
      if (!err.offline) { btn.classList.remove('loading'); btn.disabled = false; return; }
      const comments = [...(ticket.comments || []), {
        author: HD.me(), text, internal, at: new Date().toISOString(),
        time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      }];
      _localTicketUpdate(ticket.id, { comments });
      ticket = { ...ticket, comments };
    }
    $('reply-text').value = '';
    const next = $('submit-status').value;
    $('submit-status').value = '';
    if (next && next !== ticket.status) await update({ status: next, ...(next === 'Em andamento' && !ticket.assignee ? { assignee: HD.me() } : {}) });
    await load();
    btn.classList.remove('loading'); btn.disabled = false;
    $('thread').scrollTop = $('thread').scrollHeight;
    showToast(internal ? 'Nota interna adicionada.' : 'Resposta enviada.', 'success');
  });

  window.renderPage = () => { if (ticket) { const t = (window.TICKETS || []).find(x => x.id === ticket.id); if (t && !t._pending) ticket = t; render(); } };

  // ── Init ──────────────────────────────────────────────────────────────────
  window.addEventListener('load', () => {
    checkAuth();
    if (!raw) { $('loading').hidden = true; $('not-found').hidden = false; return; }
    ticket = (window.TICKETS || []).find(x => x.id === ID) || null; // mostra na hora o que já tem
    if (ticket) render();
    load();
    setInterval(load, 20000);
  });
})();
