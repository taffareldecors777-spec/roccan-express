(() => {
  'use strict';
  const root = document.getElementById('app');
  const ROLE = { pintor: 'Pintor', sindico: 'Síndico', administradora: 'Administradora', proprietario: 'Proprietário' };
  const TIPOS = ['Pintura', 'Reforma', 'Manutenção predial', 'Fachada', 'Outro'];
  const STATUS = { enviado: ['Enviado', 'azul'], aprovado: ['Aprovado', 'verde'], recusado: ['Recusado', 'verm'], expirado: ['Expirado', ''], cancelado: ['Cancelado', ''], aberto: ['Aberto', 'azul'], fechado: ['Fechado', 'verde'] };
  let user = null;

  // ---------- utilidades (sem innerHTML: tudo vira texto) ----------
  const h = (tag, props, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (['value', 'checked', 'disabled', 'selected'].includes(k)) e[k] = v;
      else e.setAttribute(k, v);
    }
    for (const c of kids.flat(2)) { if (c == null || c === false) continue; e.append(c.nodeType ? c : document.createTextNode(String(c))); }
    return e;
  };
  const money = c => 'R$ ' + (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const parseMoney = s => {
    s = String(s || '').replace(/[^\d.,]/g, '');
    if (!s) return 0;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (!/^\d+\.\d{1,2}$/.test(s)) s = s.replace(/\./g, '');
    const n = parseFloat(s);
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  };
  const dt = iso => new Date(iso).toLocaleDateString('pt-BR');
  const pill = s => h('span', { class: 'pill ' + ((STATUS[s] || [0, ''])[1]) }, (STATUS[s] || [s])[0]);
  const wa = (num, text) => 'https://wa.me/' + String(num || '').replace(/\D/g, '') + '?text=' + encodeURIComponent(text);

  let toastT;
  const toast = (msg, err) => {
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const t = h('div', { class: 'toast' + (err ? ' err' : ''), role: 'status' }, msg);
    document.body.append(t); clearTimeout(toastT); toastT = setTimeout(() => t.remove(), 3500);
  };
  const api = async (method, url, body) => {
    const r = await fetch('/api' + url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
    let d = {}; try { d = await r.json(); } catch { /* sem corpo */ }
    if (!r.ok) { const e = new Error(d.erro || 'Algo deu errado. Tente de novo.'); e.status = r.status; throw e; }
    return d;
  };
  const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { if (e.status === 401 && user) { user = null; location.hash = '#/entrar'; } toast(e.message, true); } };
  const go = hash => { if (location.hash === hash) route(); else location.hash = hash; };
  const show = (...nodes) => { root.replaceChildren(...nodes); window.scrollTo(0, 0); };
  const field = (label, input) => h('label', { class: 'field' }, h('span', null, label), input);

  function layout(active, ...content) {
    const isP = user.papel === 'pintor';
    const tabs = [['#/inicio', 'Início', 'inicio'], ['#/pedidos', isP ? 'Pedidos' : 'Meus pedidos', 'pedidos'], ['#/orcamentos', isP ? 'Orçamentos' : 'Propostas', 'orcamentos'], ['#/conta', 'Conta', 'conta']];
    show(h('div', { class: 'wrap' },
      h('div', { class: 'top' }, h('div', { class: 'logo' }, 'ROCCAN ', h('b', null, 'SOLUÇÕES')), h('div', { class: 'who' }, user.nome.split(' ')[0] + ' · ' + ROLE[user.papel])),
      ...content),
      h('nav', { class: 'nav', 'aria-label': 'Menu' }, tabs.map(([href, label, key]) => h('a', { href, class: key === active ? 'on' : '' }, label))));
  }

  // ---------- entrar / cadastrar ----------
  function authShell(title, ...content) {
    show(h('div', { class: 'wrap' }, h('div', { class: 'top' }, h('div', { class: 'logo' }, 'ROCCAN ', h('b', null, 'SOLUÇÕES'))), h('h1', null, title), ...content));
  }
  function entrar() {
    const email = h('input', { type: 'email', autocomplete: 'email', required: true }), senha = h('input', { type: 'password', autocomplete: 'current-password', required: true });
    const btn = h('button', { class: 'btn full', type: 'submit' }, 'Entrar');
    authShell('Entrar no app',
      h('div', { class: 'tabs' }, h('a', { href: '#/entrar', class: 'on' }, 'Entrar'), h('a', { href: '#/cadastro' }, 'Criar conta')),
      h('form', { onsubmit: guard(async e => { e.preventDefault(); btn.disabled = true; try { user = (await api('POST', '/login', { email: email.value, senha: senha.value })).user; go('#/inicio'); } finally { btn.disabled = false; } }) },
        field('E-mail', email), field('Senha', senha), btn),
      h('p', { class: 'mut small' }, 'Mesmo login no celular e no computador.'));
  }
  function cadastro() {
    const nome = h('input', { autocomplete: 'name', required: true, maxlength: 80 }), email = h('input', { type: 'email', autocomplete: 'email', required: true }),
      whats = h('input', { type: 'tel', inputmode: 'tel', placeholder: '47 99999-9999', required: true }), senha = h('input', { type: 'password', autocomplete: 'new-password', minlength: 8, required: true }),
      papel = h('select', null, Object.entries(ROLE).map(([k, v]) => h('option', { value: k }, v))), ok = h('input', { type: 'checkbox', required: true });
    const btn = h('button', { class: 'btn full', type: 'submit' }, 'Criar minha conta');
    authShell('Criar conta',
      h('div', { class: 'tabs' }, h('a', { href: '#/entrar' }, 'Entrar'), h('a', { href: '#/cadastro', class: 'on' }, 'Criar conta')),
      h('form', { onsubmit: guard(async e => { e.preventDefault(); btn.disabled = true; try { user = (await api('POST', '/register', { nome: nome.value, email: email.value, whats: whats.value, senha: senha.value, papel: papel.value, consentimento: ok.checked })).user; go('#/inicio'); } finally { btn.disabled = false; } }) },
        field('Nome', nome), field('Eu sou', papel), field('WhatsApp', whats), field('E-mail', email), field('Senha (mínimo 8 caracteres)', senha),
        h('label', { class: 'chk' }, ok, h('span', null, 'Li e aceito a ', h('a', { href: '/privacidade', target: '_blank', rel: 'noopener' }, 'Política de Privacidade'), ' e os ', h('a', { href: '/termos', target: '_blank', rel: 'noopener' }, 'Termos de Uso'), '.')),
        btn));
  }

  // ---------- início ----------
  async function inicio() {
    const isP = user.papel === 'pintor';
    const [ped, orc] = await Promise.all([api('GET', '/pedidos'), api('GET', '/orcamentos')]);
    const pendentes = orc.orcamentos.filter(o => o.status === 'enviado').length;
    layout('inicio', h('h1', null, 'Olá, ' + user.nome.split(' ')[0] + '!'),
      h('div', { class: 'big' },
        h('a', { class: 'card', href: '#/pedidos' }, h('b', null, ped.pedidos.length), h('span', { class: 'mut small' }, isP ? 'pedidos abertos' : 'meus pedidos')),
        h('a', { class: 'card', href: '#/orcamentos' }, h('b', null, pendentes), h('span', { class: 'mut small' }, isP ? 'orçamentos aguardando' : 'propostas aguardando'))),
      h('h2', null, 'O que você quer fazer?'),
      isP ? [h('a', { class: 'btn full', href: '#/novo-orcamento' }, '+ Novo orçamento'), h('p'), h('a', { class: 'btn sec full', href: '#/pedidos' }, 'Ver pedidos de serviço')]
        : [h('a', { class: 'btn full', href: '#/novo-pedido' }, '+ Pedir um serviço'), h('p'), h('a', { class: 'btn sec full', href: '#/orcamentos' }, 'Ver propostas recebidas')]);
  }

  // ---------- pedidos ----------
  async function pedidos() {
    const isP = user.papel === 'pintor';
    const { pedidos: list } = await api('GET', '/pedidos');
    layout('pedidos',
      h('div', { class: 'row' }, h('h1', null, isP ? 'Pedidos abertos' : 'Meus pedidos'), !isP && h('a', { class: 'btn', href: '#/novo-pedido' }, '+ Novo')),
      list.length ? list.map(p => h('a', { class: 'card', href: '#/pedido/' + p.id },
        h('div', { class: 'row' }, h('b', null, p.titulo), isP ? (p.minhas ? pill('enviado') : null) : pill(p.status)),
        h('div', { class: 'mut small' }, p.tipo + ' · ' + p.cidade + (isP ? ' · ' + p.solicitante : ' · ' + p.propostas + ' proposta(s)')),
        isP && p.descricao && h('div', { class: 'small' }, p.descricao.slice(0, 120)))) : h('p', { class: 'mut' }, isP ? 'Nenhum pedido aberto agora. Volte mais tarde, ou crie um orçamento direto para seu cliente.' : 'Você ainda não pediu nenhum serviço.'),
      isP && h('a', { class: 'btn sec full', href: '#/novo-orcamento' }, '+ Orçamento direto para um cliente'));
  }
  async function pedido(id) {
    const d = await api('GET', '/pedidos/' + id), p = d.pedido;
    layout('pedidos', h('p', null, h('a', { href: '#/pedidos' }, '← Voltar')),
      h('div', { class: 'row' }, h('h1', null, p.titulo), pill(p.status)),
      h('p', { class: 'mut' }, p.tipo + ' · ' + p.cidade + ' · ' + dt(p.criado) + (d.dono ? '' : ' · ' + p.solicitante)),
      p.descricao && h('div', { class: 'card' }, p.descricao),
      d.dono ? [h('h2', null, 'Propostas recebidas'), d.propostas.length ? d.propostas.map(o => h('a', { class: 'card', href: '#/orcamento/' + o.id }, h('div', { class: 'row' }, h('b', null, o.pintor), pill(o.status)), h('div', { class: 'row' }, h('span', { class: 'mut small' }, o.titulo), h('b', null, money(o.total))))) : h('p', { class: 'mut' }, 'Ainda sem propostas. Os pintores já estão vendo seu pedido.')]
        : (d.minha ? h('a', { class: 'btn full', href: '#/orcamento/' + d.minha }, 'Ver minha proposta') : h('a', { class: 'btn full', href: '#/novo-orcamento/' + p.id }, 'Enviar proposta')));
  }
  function novoPedido() {
    if (user.papel === 'pintor') return go('#/pedidos');
    const titulo = h('input', { required: true, maxlength: 100, placeholder: 'Ex.: Pintura da fachada do bloco A' }), tipo = h('select', null, TIPOS.map(t => h('option', null, t))),
      cidade = h('input', { required: true, maxlength: 60 }), desc = h('textarea', { rows: 4, maxlength: 1000, placeholder: 'Conte o que precisa: tamanho, prazo, detalhes...' });
    const btn = h('button', { class: 'btn full', type: 'submit' }, 'Publicar pedido');
    layout('pedidos', h('p', null, h('a', { href: '#/pedidos' }, '← Voltar')), h('h1', null, 'Pedir um serviço'),
      h('form', { onsubmit: guard(async e => { e.preventDefault(); btn.disabled = true; try { const r = await api('POST', '/pedidos', { titulo: titulo.value, tipo: tipo.value, cidade: cidade.value, descricao: desc.value }); toast('Pedido publicado!'); go('#/pedido/' + r.id); } finally { btn.disabled = false; } }) },
        field('O que você precisa?', titulo), field('Tipo', tipo), field('Cidade', cidade), field('Detalhes', desc), btn));
  }

  // ---------- orçamentos ----------
  async function orcamentos() {
    const isP = user.papel === 'pintor';
    const { orcamentos: list } = await api('GET', '/orcamentos');
    layout('orcamentos',
      h('div', { class: 'row' }, h('h1', null, isP ? 'Meus orçamentos' : 'Propostas'), isP && h('a', { class: 'btn', href: '#/novo-orcamento' }, '+ Novo')),
      list.length ? list.map(o => h('a', { class: 'card', href: '#/orcamento/' + o.id },
        h('div', { class: 'row' }, h('b', null, o.titulo), pill(o.status)),
        h('div', { class: 'row' }, h('span', { class: 'mut small' }, o.cliente_nome + ' · ' + dt(o.criado)), h('b', null, money(o.total))))) : h('p', { class: 'mut' }, isP ? 'Você ainda não fez orçamentos.' : 'Nenhuma proposta recebida ainda.'));
  }
  async function novoOrcamento(pedidoId) {
    if (user.papel !== 'pintor') return go('#/pedidos');
    let ped = null;
    if (pedidoId) ped = (await api('GET', '/pedidos/' + pedidoId)).pedido;
    const cNome = h('input', { maxlength: 80, required: !ped, placeholder: 'Nome do cliente' }), cWhats = h('input', { type: 'tel', inputmode: 'tel', placeholder: '47 99999-9999 (opcional)' });
    const titulo = h('input', { required: true, maxlength: 100, value: ped ? 'Proposta: ' + ped.titulo.slice(0, 80) : '', placeholder: 'Ex.: Pintura externa do prédio' });
    const validade = h('select', null, [7, 15, 30, 60].map(d => h('option', { value: String(d), selected: d === 15 }, d + ' dias')));
    const obs = h('textarea', { rows: 3, maxlength: 1000, placeholder: 'Materiais, prazo, condições de pagamento...' });
    const itensBox = h('div'), totalEl = h('div', { class: 'tot' });
    const rows = [];
    const recalc = () => { totalEl.textContent = 'Total: ' + money(rows.reduce((s, r) => s + (parseInt(r.q.value, 10) || 0) * parseMoney(r.v.value), 0)); };
    const addRow = () => {
      const r = { d: h('input', { placeholder: 'Descrição do item', maxlength: 120, 'aria-label': 'Descrição' }), q: h('input', { type: 'number', min: 1, max: 9999, value: '1', inputmode: 'numeric', 'aria-label': 'Quantidade' }), v: h('input', { placeholder: '0,00', inputmode: 'decimal', 'aria-label': 'Valor unitário' }) };
      const x = h('button', { type: 'button', class: 'x', 'aria-label': 'Remover item', onclick: () => { if (rows.length > 1) { rows.splice(rows.indexOf(r), 1); r.nodes.forEach(n => n.remove()); recalc(); } } }, '×');
      r.nodes = [r.d, r.q, r.v, x]; [r.q, r.v].forEach(i => i.addEventListener('input', recalc));
      rows.push(r); itensBox.append(h('div', { class: 'itens' }, ...r.nodes));
    };
    addRow(); recalc();
    const btn = h('button', { class: 'btn full', type: 'submit' }, 'Criar orçamento');
    layout('orcamentos', h('p', null, h('a', { href: ped ? '#/pedido/' + ped.id : '#/orcamentos' }, '← Voltar')), h('h1', null, ped ? 'Proposta para o pedido' : 'Novo orçamento'),
      ped && h('div', { class: 'card' }, h('b', null, ped.titulo), h('div', { class: 'mut small' }, ped.tipo + ' · ' + ped.cidade)),
      h('form', {
        onsubmit: guard(async e => {
          e.preventDefault(); btn.disabled = true;
          try {
            const itens = rows.map(r => ({ d: r.d.value, q: parseInt(r.q.value, 10), v: parseMoney(r.v.value) }));
            const body = { titulo: titulo.value, itens, validade_dias: Number(validade.value), obs: obs.value };
            if (ped) body.pedido_id = ped.id; else { body.cliente_nome = cNome.value; body.cliente_whats = cWhats.value; }
            const r = await api('POST', '/orcamentos', body); toast('Orçamento criado!'); go('#/orcamento/' + r.id);
          } finally { btn.disabled = false; }
        })
      },
        !ped && field('Cliente', cNome), !ped && field('WhatsApp do cliente', cWhats), field('Título do serviço', titulo),
        h('h2', null, 'Itens'), itensBox, h('button', { type: 'button', class: 'btn sec', onclick: () => { addRow(); } }, '+ Adicionar item'), totalEl,
        field('Validade da proposta', validade), field('Observações', obs), btn));
  }

  function orcView(o, opts) {
    const nodes = [
      h('div', { class: 'row' }, h('h1', null, o.titulo), pill(o.status)),
      h('p', { class: 'mut' }, (opts.pintorNome ? 'Profissional: ' + opts.pintorNome + ' · ' : '') + (o.cliente_nome ? 'Cliente: ' + o.cliente_nome + ' · ' : '') + dt(o.criado) + ' · validade ' + o.validade_dias + ' dias'),
      h('div', { class: 'card' }, h('table', null, h('tr', null, h('th', null, 'Item'), h('th', { class: 'r' }, 'Qtd'), h('th', { class: 'r' }, 'Valor')),
        o.itens.map(i => h('tr', null, h('td', null, i.d), h('td', { class: 'r' }, i.q), h('td', { class: 'r' }, money(i.q * i.v))))), h('div', { class: 'tot' }, money(o.total))),
      o.obs && h('div', { class: 'card' }, h('div', { class: 'mut small' }, 'Observações'), o.obs)
    ];
    if (o.status === 'aprovado' && o.contrato) {
      nodes.push(h('h2', null, 'Contrato'), h('pre', { class: 'contrato' }, o.contrato),
        h('div', { class: 'noprint' }, h('button', { class: 'btn full', type: 'button', onclick: () => window.print() }, 'Imprimir / salvar em PDF'), h('p')));
    }
    return nodes;
  }
  async function orcamento(id) {
    const { orcamento: o } = await api('GET', '/orcamentos/' + id);
    const reload = () => route();
    const nodes = orcView(o, { pintorNome: o.papel === 'cliente' && o.pintor ? o.pintor.nome : null });
    const actions = h('div', { class: 'noprint' });
    if (o.status === 'enviado' && o.papel === 'pintor') {
      if (o.token) {
        const link = location.origin + '/o/' + o.token;
        const inp = h('input', { readonly: true, value: link, 'aria-label': 'Link do orçamento' });
        actions.append(h('h2', null, 'Enviar ao cliente'), inp,
          h('p', null, h('button', { class: 'btn sec', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(link); toast('Link copiado!'); } catch { inp.select(); toast('Selecione e copie o link'); } } }, 'Copiar link'), ' ',
            h('a', { class: 'btn ok', target: '_blank', rel: 'noopener', href: wa(o.cliente_whats, 'Olá ' + o.cliente_nome + '! Segue seu orçamento "' + o.titulo + '" (' + money(o.total) + '): ' + link) }, 'Enviar pelo WhatsApp')));
      } else actions.append(h('p', { class: 'mut' }, 'Proposta enviada. O solicitante vai analisar e te avisar pelo WhatsApp se aprovar.'));
      actions.append(h('p', null, h('button', { class: 'btn bad', type: 'button', onclick: guard(async () => { await api('POST', '/orcamentos/' + o.id + '/cancelar', {}); toast('Orçamento cancelado'); reload(); }) }, 'Cancelar orçamento')));
    }
    if (o.status === 'enviado' && o.papel === 'cliente') {
      const ok = h('input', { type: 'checkbox' });
      actions.append(h('label', { class: 'chk' }, ok, h('span', null, 'Aceito esta proposta e concordo em gerar o contrato com o valor de ' + money(o.total) + '.')),
        h('button', { class: 'btn ok full', type: 'button', onclick: guard(async () => { await api('POST', '/orcamentos/' + o.id + '/aprovar', { aceite: ok.checked }); toast('Proposta aprovada! Contrato gerado.'); reload(); }) }, 'Aprovar proposta'), h('p'),
        h('button', { class: 'btn bad full', type: 'button', onclick: guard(async () => { await api('POST', '/orcamentos/' + o.id + '/recusar', {}); toast('Proposta recusada'); reload(); }) }, 'Recusar'));
    }
    if (o.status === 'aprovado') {
      const outroNum = o.papel === 'pintor' ? o.cliente_whats : (o.pintor && o.pintor.whats);
      if (outroNum) actions.append(h('a', { class: 'btn ok full', target: '_blank', rel: 'noopener', href: wa(outroNum, 'Olá! Sobre o contrato "' + o.titulo + '" na Roccan Soluções.') }, 'Falar no WhatsApp'));
    }
    layout('orcamentos', h('p', { class: 'noprint' }, h('a', { href: o.pedido_id ? '#/pedido/' + o.pedido_id : '#/orcamentos' }, '← Voltar')), ...nodes, actions);
  }

  // ---------- página pública do orçamento (/o/TOKEN) ----------
  async function publico(token) {
    let d;
    try { d = await api('GET', '/publico/' + token); } catch (e) { return authShell('Orçamento não encontrado', h('p', { class: 'mut' }, 'Confira o link com quem enviou.')); }
    const o = d.orcamento;
    o.contrato = d.contrato;
    const actions = h('div', { class: 'noprint' });
    if (o.status === 'enviado') {
      const nome = h('input', { maxlength: 80, placeholder: 'Seu nome completo', autocomplete: 'name' }), ok = h('input', { type: 'checkbox' });
      actions.append(h('h2', null, 'Aprovar este orçamento'), field('Seu nome', nome),
        h('label', { class: 'chk' }, ok, h('span', null, 'Aceito este orçamento de ' + money(o.total) + ' e concordo em gerar o contrato.')),
        h('button', { class: 'btn ok full', type: 'button', onclick: guard(async () => { await api('POST', '/publico/' + token + '/aprovar', { nome: nome.value, aceite: ok.checked }); toast('Orçamento aprovado!'); publico(token); }) }, 'Aprovar'), h('p'),
        h('button', { class: 'btn bad full', type: 'button', onclick: guard(async () => { await api('POST', '/publico/' + token + '/recusar', {}); toast('Orçamento recusado'); publico(token); }) }, 'Recusar'));
    }
    if (o.status === 'aprovado' && d.pintor) actions.append(h('a', { class: 'btn ok full', target: '_blank', rel: 'noopener', href: wa(d.pintor.whats, 'Olá! Aprovei o orçamento "' + o.titulo + '".') }, 'Falar com o profissional no WhatsApp'));
    show(h('div', { class: 'wrap' }, h('div', { class: 'top' }, h('div', { class: 'logo' }, 'ROCCAN ', h('b', null, 'SOLUÇÕES'))), ...orcView(o, { pintorNome: d.pintor && d.pintor.nome }), actions));
  }

  // ---------- conta ----------
  function conta() {
    const atual = h('input', { type: 'password', autocomplete: 'current-password' }), nova = h('input', { type: 'password', autocomplete: 'new-password', minlength: 8 }), del = h('input', { type: 'password', autocomplete: 'current-password' });
    layout('conta', h('h1', null, 'Minha conta'),
      h('div', { class: 'card' }, h('b', null, user.nome), h('div', { class: 'mut small' }, ROLE[user.papel] + ' · ' + user.email), h('div', { class: 'mut small' }, 'WhatsApp ' + user.whats)),
      h('h2', null, 'Trocar senha'),
      h('form', { onsubmit: guard(async e => { e.preventDefault(); await api('POST', '/me/senha', { atual: atual.value, nova: nova.value }); atual.value = nova.value = ''; toast('Senha alterada!'); }) }, field('Senha atual', atual), field('Nova senha', nova), h('button', { class: 'btn sec', type: 'submit' }, 'Trocar senha')),
      h('h2', null, 'Meus dados'),
      h('p', null, h('a', { class: 'btn sec', href: '/api/me/export', download: 'meus-dados-roccan.json' }, 'Baixar meus dados')),
      h('p', { class: 'mut small' }, h('a', { href: '/privacidade', target: '_blank', rel: 'noopener' }, 'Privacidade'), ' · ', h('a', { href: '/termos', target: '_blank', rel: 'noopener' }, 'Termos')),
      h('h2', null, 'Sair'),
      h('button', { class: 'btn sec', type: 'button', onclick: guard(async () => { await api('POST', '/logout', {}); user = null; go('#/entrar'); }) }, 'Sair da conta'),
      h('h2', null, 'Excluir conta'),
      h('p', { class: 'mut small' }, 'Apaga seus dados e pedidos. Contratos já aprovados continuam guardados, pois envolvem a outra parte.'),
      h('form', { onsubmit: guard(async e => { e.preventDefault(); await api('DELETE', '/me', { senha: del.value }); user = null; toast('Conta excluída'); go('#/entrar'); }) }, field('Digite sua senha para confirmar', del), h('button', { class: 'btn bad', type: 'submit' }, 'Excluir minha conta')));
  }

  // ---------- roteador ----------
  async function route() {
    try {
      const mo = location.pathname.match(/^\/o\/([A-Za-z0-9_-]+)$/);
      if (mo) return await publico(mo[1]);
      if (!user) { try { user = (await api('GET', '/me')).user; } catch { /* deslogado */ } }
      const [r, a] = location.hash.replace(/^#\/?/, '').split('/');
      if (!user) return r === 'cadastro' ? cadastro() : entrar();
      switch (r) {
        case 'pedidos': return await pedidos();
        case 'pedido': return await pedido(a);
        case 'novo-pedido': return novoPedido();
        case 'orcamentos': return await orcamentos();
        case 'orcamento': return await orcamento(a);
        case 'novo-orcamento': return await novoOrcamento(a);
        case 'conta': return conta();
        default: return await inicio();
      }
    } catch (e) {
      if (e.status === 401) { user = null; return entrar(); }
      toast(e.message, true);
      if (user) layout('inicio', h('p', { class: 'mut' }, 'Não foi possível carregar. '), h('a', { class: 'btn', href: '#/inicio' }, 'Voltar ao início'));
    }
  }
  window.addEventListener('hashchange', route);
  route();
})();
