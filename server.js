'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { open } = require('./db');

const PUB = path.join(__dirname, 'public');
const PROD = !!process.env.RENDER || process.env.NODE_ENV === 'production';

// ====== CONFIGURAÇÕES (variáveis de ambiente no Render, ou valores padrão) ======
const WHATS = process.env.WHATS || '5547999732214';
const BASE_URL = process.env.BASE_URL || '';
const MP_TOKEN = process.env.MP_TOKEN || '';
const PLANOS = [
  { id: 'pintor', nome: 'Pintor', preco: 9.9, desc: 'Orçamentos, contratos e recebimento no app. Mais clientes.' },
  { id: 'sindico', nome: 'Síndico', preco: 9.9, desc: 'Compare orçamentos e acompanhe a obra do condomínio.' },
  { id: 'administradora', nome: 'Administradora', preco: 9.9, desc: 'Gestão de vários condomínios, prazos e controle de custos.' }
];
// ================================================================================

const PAPEIS = ['pintor', 'sindico', 'administradora', 'proprietario'];
const TIPOS = ['Pintura', 'Reforma', 'Manutenção predial', 'Fachada', 'Outro'];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};
const CSP_APP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const CSP_SITE = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'";

// ---------- utilidades ----------
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const brl = c => 'R$ ' + (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = (v, min, max) => { if (typeof v !== 'string') return null; const t = v.trim(); return t.length >= min && t.length <= max ? t : null; };
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const ID = /^[0-9a-f-]{36}$/;
const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;
const phone = v => { if (typeof v !== 'string') return null; let d = v.replace(/\D/g, ''); if (d.length === 10 || d.length === 11) d = '55' + d; return /^55\d{10,11}$/.test(d) ? d : null; };
const fmtPhone = d => { const n = d.replace(/^55/, ''); return n.length === 11 ? `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}` : `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`; };
const expirou = o => o.status === 'enviado' && Date.now() > Date.parse(o.criado) + o.validade_dias * 86400000;
const statusEf = o => (expirou(o) ? 'expirado' : o.status);
const equalSafe = (a, b) => crypto.timingSafeEqual(Buffer.from(sha(String(a))), Buffer.from(sha(String(b))));
const fail = (status, erro) => Object.assign(new Error(erro), { status });

async function hashSenha(s) {
  const salt = crypto.randomBytes(16);
  const h = await new Promise((r, j) => crypto.scrypt(s, salt, 64, (e, k) => (e ? j(e) : r(k))));
  return salt.toString('hex') + ':' + h.toString('hex');
}
async function confereSenha(s, stored) {
  const [salt, h] = String(stored).split(':');
  const k = await new Promise((r, j) => crypto.scrypt(s, Buffer.from(salt, 'hex'), 64, (e, x) => (e ? j(e) : r(x))));
  const b = Buffer.from(h, 'hex');
  return b.length === k.length && crypto.timingSafeEqual(b, k);
}
const DUMMY_HASH = '00000000000000000000000000000000:' + '00'.repeat(64);

function validaItens(v) {
  if (!Array.isArray(v) || v.length < 1 || v.length > 30) return null;
  const out = []; let total = 0;
  for (const i of v) {
    if (!i || typeof i !== 'object') return null;
    const d = S(i.d, 1, 120), q = Number(i.q), val = Number(i.v);
    if (!d || !Number.isInteger(q) || q < 1 || q > 9999 || !Number.isInteger(val) || val < 0 || val > 100000000) return null;
    total += q * val; out.push({ d, q, v: val });
  }
  return total > 1000000000 ? null : { itens: out, total };
}

function gerarContrato(o, pintor, contratante, aprovadoPor) {
  const itens = JSON.parse(o.itens);
  const L = ['CONTRATO DE PRESTAÇÃO DE SERVIÇOS', '', 'Orçamento nº ' + o.id.slice(0, 8).toUpperCase(), '',
    'CONTRATADO(A): ' + pintor.nome + ' - WhatsApp ' + fmtPhone(pintor.whats),
    'CONTRATANTE: ' + contratante, '', '1. OBJETO', 'Execução do serviço "' + o.titulo + '", conforme os itens:'];
  itens.forEach((i, n) => L.push('   ' + (n + 1) + '. ' + i.d + ' - ' + i.q + ' x ' + brl(i.v) + ' = ' + brl(i.q * i.v)));
  L.push('', '2. VALOR', 'Valor total: ' + brl(o.total) + '. Forma e datas de pagamento: a combinar entre as partes, por escrito.',
    '', '3. CONDIÇÕES',
    'a) Materiais, prazos e detalhes não descritos acima devem ser combinados por escrito entre as partes.',
    'b) Mudanças de escopo ou de valor só valem com a concordância das duas partes.',
    'c) O(A) CONTRATADO(A) responde pela execução e qualidade do serviço; o(a) CONTRATANTE, pelo pagamento e pelo acesso ao local.');
  if (o.obs) L.push('', '4. OBSERVAÇÕES DO ORÇAMENTO', o.obs);
  L.push('', 'ACEITE ELETRÔNICO', 'Aprovado por ' + aprovadoPor + ' em ' + new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + '.',
    '', 'Aviso: modelo simples gerado pela plataforma Roccan Soluções. Não substitui orientação jurídica, e a Roccan Soluções não é parte deste contrato.');
  return L.join('\n');
}

// ---------- app ----------
async function createApp(opts = {}) {
  const db = opts.db || (await open(opts));
  const rateMult = opts.rateMult || 1;
  const hits = new Map();
  const limited = (key, max, ms) => {
    const t = Date.now(); const a = (hits.get(key) || []).filter(x => t - x < ms);
    if (a.length >= max * rateMult) { hits.set(key, a); return true; }
    a.push(t); hits.set(key, a); return false;
  };
  const prune = setInterval(() => { const t = Date.now(); for (const [k, a] of hits) if (!a.length || t - a[a.length - 1] > 3600000) hits.delete(k); }, 600000);
  prune.unref();

  const ipOf = req => { const x = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean); return x.length ? x[x.length - 1] : req.socket.remoteAddress || '?'; };
  const cookies = req => Object.fromEntries(String(req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(a => a.length >= 2).map(a => [a[0], a.slice(1).join('=')]));
  const secure = req => PROD || req.headers['x-forwarded-proto'] === 'https';

  function send(res, code, body, headers = {}) {
    res.writeHead(code, { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', ...(PROD ? { 'Strict-Transport-Security': 'max-age=15552000' } : {}), ...headers });
    res.end(body);
  }
  const json = (res, code, obj, h = {}) => send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': CSP_APP, ...h });

  function readBody(req, max = 100000) {
    return new Promise((resolve, reject) => {
      let n = 0, over = false; const chunks = [];
      req.on('data', c => { n += c.length; if (n > max) over = true; else chunks.push(c); });
      req.on('error', reject);
      req.on('end', () => {
        if (over) return reject(fail(413, 'Corpo muito grande'));
        const s = Buffer.concat(chunks).toString('utf8');
        if (!s) return resolve({});
        if (!/^application\/json/i.test(req.headers['content-type'] || '')) return reject(fail(415, 'Conteúdo inválido'));
        try { const o = JSON.parse(s); if (!o || typeof o !== 'object' || Array.isArray(o)) throw 0; resolve(o); } catch { reject(fail(400, 'JSON inválido')); }
      });
    });
  }

  async function authUser(req) {
    const sid = cookies(req).sid;
    if (!sid || !TOKEN.test(sid)) return null;
    return (await db.get('SELECT u.id,u.nome,u.email,u.whats,u.papel FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expira>?', [sha(sid), now()])) || null;
  }
  async function novaSessao(req, res, userId, extra = {}) {
    const tok = crypto.randomBytes(32).toString('base64url');
    await db.run('INSERT INTO sessions (token_hash,user_id,expira) VALUES (?,?,?)', [sha(tok), userId, new Date(Date.now() + 30 * 86400000).toISOString()]);
    return { 'Set-Cookie': `sid=${tok}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure(req) ? '; Secure' : ''}`, ...extra };
  }
  const userOut = u => ({ id: u.id, nome: u.nome, email: u.email, whats: u.whats, papel: u.papel });

  const orcOut = (o, extra = {}) => ({
    id: o.id, pedido_id: o.pedido_id, titulo: o.titulo, cliente_nome: o.cliente_nome, cliente_whats: o.cliente_whats,
    itens: JSON.parse(o.itens), total: o.total, validade_dias: o.validade_dias, obs: o.obs,
    status: statusEf(o), aprovado_em: o.aprovado_em, aprovado_por: o.aprovado_por, criado: o.criado, ...extra
  });

  // ---------- rotas da API ----------
  async function api(req, res, url) {
    const m = req.method, p = url.pathname.slice(4); // sem "/api"
    let mt;

    if (m === 'GET' && p === '/config') return json(res, 200, { whats: WHATS, planos: PLANOS });

    if (m === 'POST' && p === '/lead') {
      if (limited('lead:' + ipOf(req), 20, 3600000)) throw fail(429, 'Muitas tentativas. Tente mais tarde.');
      const b = await readBody(req);
      const nome = S(b.nome, 2, 100), w = S(b.whats, 8, 30);
      if (!nome || !w) throw fail(400, 'Preencha nome e WhatsApp');
      await db.run('INSERT INTO leads (id,nome,whats,perfil,msg,criado) VALUES (?,?,?,?,?,?)', [uid(), nome, w, String(b.perfil || '').slice(0, 60), String(b.msg || '').slice(0, 500), now()]);
      return json(res, 200, { ok: true });
    }

    if (m === 'POST' && p === '/checkout') {
      if (limited('lead:' + ipOf(req), 20, 3600000)) throw fail(429, 'Muitas tentativas. Tente mais tarde.');
      const b = await readBody(req);
      const pl = PLANOS.find(x => x.id === b.plano), nome = S(b.nome, 2, 100), w = S(b.whats, 8, 30);
      if (!pl || !nome || !w) throw fail(400, 'Preencha nome, WhatsApp e escolha o plano');
      await db.run('INSERT INTO leads (id,nome,whats,perfil,msg,criado) VALUES (?,?,?,?,?,?)', [uid(), nome, w, 'Pré-venda: ' + pl.nome, 'Quer garantir acesso ao plano ' + pl.nome, now()]);
      if (!MP_TOKEN || !BASE_URL) return json(res, 200, { modo: 'whatsapp', plano: pl.nome });
      try {
        const r = await fetch('https://api.mercadopago.com/checkout/preferences', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + MP_TOKEN },
          body: JSON.stringify({ items: [{ title: 'Roccan Soluções - Plano ' + pl.nome, quantity: 1, currency_id: 'BRL', unit_price: pl.preco }], back_urls: { success: BASE_URL + '/?pago=1', failure: BASE_URL + '/?pago=0', pending: BASE_URL + '/?pago=2' }, auto_return: 'approved' })
        });
        const d = await r.json();
        if (!d.init_point) throw new Error('sem init_point');
        return json(res, 200, { modo: 'pagar', url: d.init_point });
      } catch { return json(res, 200, { modo: 'whatsapp', plano: pl.nome }); }
    }

    // ----- conta -----
    if (m === 'POST' && p === '/register') {
      if (limited('reg:' + ipOf(req), 8, 3600000)) throw fail(429, 'Muitas tentativas. Tente mais tarde.');
      const b = await readBody(req);
      const nome = S(b.nome, 2, 80), email = S(b.email, 5, 254), senha = typeof b.senha === 'string' ? b.senha : '', w = phone(b.whats);
      if (!nome) throw fail(400, 'Informe seu nome');
      if (!email || !EMAIL.test(email)) throw fail(400, 'E-mail inválido');
      if (senha.length < 8 || senha.length > 100) throw fail(400, 'A senha precisa ter de 8 a 100 caracteres');
      if (!w) throw fail(400, 'WhatsApp inválido (use DDD + número)');
      if (!PAPEIS.includes(b.papel)) throw fail(400, 'Escolha seu perfil');
      if (b.consentimento !== true) throw fail(400, 'É preciso aceitar a Política de Privacidade e os Termos');
      const em = email.toLowerCase();
      if (await db.get('SELECT id FROM users WHERE email=?', [em])) throw fail(409, 'Este e-mail já tem cadastro. Tente entrar.');
      const id = uid();
      await db.run('INSERT INTO users (id,nome,email,whats,papel,senha_hash,criado) VALUES (?,?,?,?,?,?,?)', [id, nome, em, w, b.papel, await hashSenha(senha), now()]);
      return json(res, 201, { user: { id, nome, email: em, whats: w, papel: b.papel } }, await novaSessao(req, res, id));
    }

    if (m === 'POST' && p === '/login') {
      const b = await readBody(req);
      const em = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
      if (limited('login:' + ipOf(req), 15, 600000) || limited('loginem:' + em, 8, 600000)) throw fail(429, 'Muitas tentativas. Aguarde alguns minutos.');
      const u = em ? await db.get('SELECT * FROM users WHERE email=?', [em]) : null;
      const ok = await confereSenha(typeof b.senha === 'string' ? b.senha.slice(0, 100) : '', u ? u.senha_hash : DUMMY_HASH);
      if (!u || !ok) throw fail(401, 'E-mail ou senha incorretos');
      return json(res, 200, { user: userOut(u) }, await novaSessao(req, res, u.id));
    }

    // ----- público (orçamento por link) -----
    if ((mt = p.match(/^\/publico\/([A-Za-z0-9_-]{20,64})(\/aprovar|\/recusar)?$/))) {
      const o = await db.get('SELECT * FROM orcamentos WHERE token=? AND pedido_id IS NULL', [mt[1]]);
      if (!o) throw fail(404, 'Orçamento não encontrado');
      const pintor = await db.get('SELECT nome,whats FROM users WHERE id=?', [o.user_id]);
      if (m === 'GET' && !mt[2]) {
        const c = await db.get('SELECT texto FROM contratos WHERE orcamento_id=?', [o.id]);
        return json(res, 200, { orcamento: orcOut(o, { cliente_whats: undefined }), pintor: pintor ? { nome: pintor.nome, whats: pintor.whats } : null, contrato: c ? c.texto : null });
      }
      if (m === 'POST' && mt[2]) {
        if (limited('pub:' + ipOf(req), 30, 3600000)) throw fail(429, 'Muitas tentativas. Tente mais tarde.');
        const b = await readBody(req);
        if (mt[2] === '/recusar') {
          const r = await db.run("UPDATE orcamentos SET status='recusado' WHERE id=? AND status='enviado'", [o.id]);
          if (r.changes !== 1) throw fail(409, 'Este orçamento não está mais disponível');
          return json(res, 200, { ok: true });
        }
        const nome = S(b.nome, 2, 80);
        if (!nome || b.aceite !== true) throw fail(400, 'Informe seu nome e marque o aceite');
        if (expirou(o)) throw fail(409, 'Este orçamento expirou. Peça um novo ao profissional.');
        const r = await db.run("UPDATE orcamentos SET status='aprovado',aprovado_em=?,aprovado_por=? WHERE id=? AND status='enviado'", [now(), nome, o.id]);
        if (r.changes !== 1) throw fail(409, 'Este orçamento não está mais disponível');
        const texto = gerarContrato(o, pintor, `${o.cliente_nome}${o.cliente_whats ? ' - WhatsApp ' + fmtPhone(o.cliente_whats) : ''}`, nome);
        await db.run('INSERT INTO contratos (id,orcamento_id,texto,criado) VALUES (?,?,?,?)', [uid(), o.id, texto, now()]);
        return json(res, 200, { ok: true });
      }
      throw fail(404, 'Não encontrado');
    }

    // ----- a partir daqui, só logado -----
    if (m === 'POST' && p === '/logout') {
      const sid = cookies(req).sid;
      if (sid && TOKEN.test(sid)) await db.run('DELETE FROM sessions WHERE token_hash=?', [sha(sid)]);
      return json(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
    }
    const user = await authUser(req);
    if (!user) throw fail(401, 'Entre na sua conta');
    const isPintor = user.papel === 'pintor';

    if (m === 'GET' && p === '/me') return json(res, 200, { user: userOut(user) });

    if (m === 'POST' && p === '/me/senha') {
      const b = await readBody(req);
      if (limited('pw:' + user.id, 8, 600000)) throw fail(429, 'Muitas tentativas. Aguarde alguns minutos.');
      const u = await db.get('SELECT senha_hash FROM users WHERE id=?', [user.id]);
      if (!(await confereSenha(typeof b.atual === 'string' ? b.atual.slice(0, 100) : '', u.senha_hash))) throw fail(403, 'Senha atual incorreta');
      if (typeof b.nova !== 'string' || b.nova.length < 8 || b.nova.length > 100) throw fail(400, 'A nova senha precisa ter de 8 a 100 caracteres');
      await db.run('UPDATE users SET senha_hash=? WHERE id=?', [await hashSenha(b.nova), user.id]);
      await db.run('DELETE FROM sessions WHERE user_id=?', [user.id]);
      return json(res, 200, { ok: true }, await novaSessao(req, res, user.id));
    }

    if (m === 'GET' && p === '/me/export') {
      const meus = (await db.all('SELECT * FROM orcamentos WHERE user_id=?', [user.id])).map(o => orcOut(o));
      const recebidas = (await db.all('SELECT o.* FROM orcamentos o JOIN pedidos p ON p.id=o.pedido_id WHERE p.user_id=?', [user.id])).map(o => orcOut(o));
      const pedidos = await db.all('SELECT id,titulo,tipo,cidade,descricao,status,criado FROM pedidos WHERE user_id=?', [user.id]);
      const ids = [...meus, ...recebidas].filter(o => o.status === 'aprovado').map(o => o.id);
      const contratos = [];
      for (const id of ids) { const c = await db.get('SELECT texto,criado FROM contratos WHERE orcamento_id=?', [id]); if (c) contratos.push({ orcamento_id: id, ...c }); }
      return json(res, 200, { usuario: userOut(user), pedidos, orcamentos_enviados: meus, propostas_recebidas: recebidas, contratos }, { 'Content-Disposition': 'attachment; filename="meus-dados-roccan.json"' });
    }

    if (m === 'DELETE' && p === '/me') {
      const b = await readBody(req);
      const u = await db.get('SELECT senha_hash FROM users WHERE id=?', [user.id]);
      if (!(await confereSenha(typeof b.senha === 'string' ? b.senha.slice(0, 100) : '', u.senha_hash))) throw fail(403, 'Senha incorreta');
      const meusPed = (await db.all('SELECT id FROM pedidos WHERE user_id=?', [user.id])).map(r => r.id);
      for (const pid of meusPed) {
        await db.run("UPDATE orcamentos SET status='cancelado' WHERE pedido_id=? AND status='enviado'", [pid]);
        await db.run('UPDATE orcamentos SET pedido_id=NULL WHERE pedido_id=? AND status<>?', [pid, 'cancelado']);
      }
      // contratos já aprovados ficam guardados (obrigação das duas partes); o resto é apagado
      await db.run("DELETE FROM orcamentos WHERE user_id=? AND status<>'aprovado'", [user.id]);
      await db.run('DELETE FROM pedidos WHERE user_id=?', [user.id]);
      await db.run('DELETE FROM sessions WHERE user_id=?', [user.id]);
      await db.run('DELETE FROM users WHERE id=?', [user.id]);
      return json(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
    }

    // ----- pedidos de serviço -----
    if (m === 'POST' && p === '/pedidos') {
      if (isPintor) throw fail(403, 'Pintores enviam propostas; quem pede o serviço é síndico, administradora ou proprietário');
      if (limited('ped:' + user.id, 20, 3600000)) throw fail(429, 'Muitos pedidos em pouco tempo');
      const b = await readBody(req);
      const titulo = S(b.titulo, 3, 100), cidade = S(b.cidade, 2, 60), desc = b.descricao == null || b.descricao === '' ? '' : S(b.descricao, 0, 1000);
      if (!titulo || !cidade || desc === null || !TIPOS.includes(b.tipo)) throw fail(400, 'Preencha título, tipo e cidade');
      const id = uid();
      await db.run('INSERT INTO pedidos (id,user_id,titulo,tipo,cidade,descricao,status,criado) VALUES (?,?,?,?,?,?,?,?)', [id, user.id, titulo, b.tipo, cidade, desc, 'aberto', now()]);
      return json(res, 201, { id });
    }

    if (m === 'GET' && p === '/pedidos') {
      if (isPintor) {
        const r = await db.all("SELECT p.id,p.titulo,p.tipo,p.cidade,p.descricao,p.criado,u.nome AS solicitante,(SELECT COUNT(*) FROM orcamentos o WHERE o.pedido_id=p.id AND o.user_id=? AND o.status<>'cancelado') AS minhas FROM pedidos p JOIN users u ON u.id=p.user_id WHERE p.status='aberto' AND p.user_id<>? ORDER BY p.criado DESC LIMIT 100", [user.id, user.id]);
        return json(res, 200, { pedidos: r.map(x => ({ ...x, minhas: Number(x.minhas) })) });
      }
      const r = await db.all("SELECT p.id,p.titulo,p.tipo,p.cidade,p.status,p.criado,(SELECT COUNT(*) FROM orcamentos o WHERE o.pedido_id=p.id AND o.status<>'cancelado') AS propostas FROM pedidos p WHERE p.user_id=? ORDER BY p.criado DESC LIMIT 100", [user.id]);
      return json(res, 200, { pedidos: r.map(x => ({ ...x, propostas: Number(x.propostas) })) });
    }

    if ((mt = p.match(/^\/pedidos\/([0-9a-f-]{36})$/)) && m === 'GET') {
      const ped = await db.get('SELECT p.*,u.nome AS solicitante FROM pedidos p JOIN users u ON u.id=p.user_id WHERE p.id=?', [mt[1]]);
      if (!ped) throw fail(404, 'Pedido não encontrado');
      const base = { id: ped.id, titulo: ped.titulo, tipo: ped.tipo, cidade: ped.cidade, descricao: ped.descricao, status: ped.status, criado: ped.criado, solicitante: ped.solicitante };
      if (ped.user_id === user.id) {
        const r = await db.all('SELECT o.*,u.nome AS pintor FROM orcamentos o JOIN users u ON u.id=o.user_id WHERE o.pedido_id=? ORDER BY o.criado', [ped.id]);
        return json(res, 200, { pedido: base, dono: true, propostas: r.map(o => ({ id: o.id, pintor: o.pintor, titulo: o.titulo, total: o.total, status: statusEf(o), criado: o.criado })) });
      }
      if (isPintor && ped.status === 'aberto') {
        const mine = await db.get("SELECT id FROM orcamentos WHERE pedido_id=? AND user_id=? AND status<>'cancelado'", [ped.id, user.id]);
        return json(res, 200, { pedido: base, dono: false, minha: mine ? mine.id : null });
      }
      throw fail(404, 'Pedido não encontrado');
    }

    // ----- orçamentos -----
    if (m === 'POST' && p === '/orcamentos') {
      if (!isPintor) throw fail(403, 'Só pintores criam orçamentos');
      if (limited('orc:' + user.id, 60, 3600000)) throw fail(429, 'Muitos orçamentos em pouco tempo');
      const b = await readBody(req);
      const titulo = S(b.titulo, 3, 100), it = validaItens(b.itens);
      const dias = b.validade_dias == null ? 15 : Number(b.validade_dias);
      const obs = b.obs == null || b.obs === '' ? '' : S(b.obs, 0, 1000);
      if (!titulo || !it || obs === null || !Number.isInteger(dias) || dias < 1 || dias > 90) throw fail(400, 'Confira título, itens (valores válidos) e validade');
      let pedidoId = null, cNome, cWhats = '';
      if (b.pedido_id != null && b.pedido_id !== '') {
        if (typeof b.pedido_id !== 'string' || !ID.test(b.pedido_id)) throw fail(400, 'Pedido inválido');
        const ped = await db.get('SELECT p.*,u.nome AS solicitante FROM pedidos p JOIN users u ON u.id=p.user_id WHERE p.id=?', [b.pedido_id]);
        if (!ped || ped.status !== 'aberto' || ped.user_id === user.id) throw fail(404, 'Pedido não encontrado ou já fechado');
        if (await db.get("SELECT id FROM orcamentos WHERE pedido_id=? AND user_id=? AND status<>'cancelado'", [ped.id, user.id])) throw fail(409, 'Você já enviou uma proposta para este pedido');
        pedidoId = ped.id; cNome = ped.solicitante;
      } else {
        cNome = S(b.cliente_nome, 2, 80);
        if (!cNome) throw fail(400, 'Informe o nome do cliente');
        if (b.cliente_whats) { cWhats = phone(b.cliente_whats); if (!cWhats) throw fail(400, 'WhatsApp do cliente inválido'); }
      }
      const id = uid(), token = crypto.randomBytes(18).toString('base64url');
      await db.run('INSERT INTO orcamentos (id,user_id,pedido_id,token,cliente_nome,cliente_whats,titulo,itens,total,validade_dias,obs,status,criado) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [id, user.id, pedidoId, token, cNome, cWhats, titulo, JSON.stringify(it.itens), it.total, dias, obs, 'enviado', now()]);
      return json(res, 201, { id });
    }

    if (m === 'GET' && p === '/orcamentos') {
      const r = await db.all(isPintor
        ? 'SELECT * FROM orcamentos WHERE user_id=? ORDER BY criado DESC LIMIT 200'
        : 'SELECT o.* FROM orcamentos o JOIN pedidos p ON p.id=o.pedido_id WHERE p.user_id=? ORDER BY o.criado DESC LIMIT 200', [user.id]);
      return json(res, 200, { orcamentos: r.map(o => ({ id: o.id, titulo: o.titulo, cliente_nome: o.cliente_nome, total: o.total, status: statusEf(o), criado: o.criado, pedido_id: o.pedido_id })) });
    }

    if ((mt = p.match(/^\/orcamentos\/([0-9a-f-]{36})(\/aprovar|\/recusar|\/cancelar)?$/))) {
      const o = await db.get('SELECT * FROM orcamentos WHERE id=?', [mt[1]]);
      if (!o) throw fail(404, 'Orçamento não encontrado');
      let papel = null, ped = null;
      if (o.user_id === user.id) papel = 'pintor';
      else if (o.pedido_id) { ped = await db.get('SELECT * FROM pedidos WHERE id=?', [o.pedido_id]); if (ped && ped.user_id === user.id) papel = 'cliente'; }
      if (!papel) throw fail(404, 'Orçamento não encontrado');

      if (m === 'GET' && !mt[2]) {
        const c = await db.get('SELECT texto FROM contratos WHERE orcamento_id=?', [o.id]);
        const pintor = await db.get('SELECT nome,whats FROM users WHERE id=?', [o.user_id]);
        const extra = { papel, contrato: c ? c.texto : null, pintor: pintor ? { nome: pintor.nome, whats: o.status === 'aprovado' || papel === 'pintor' ? pintor.whats : null } : null };
        if (papel === 'pintor' && !o.pedido_id) extra.token = o.token;
        if (papel === 'cliente' && o.status !== 'aprovado') extra.cliente_whats = '';
        return json(res, 200, { orcamento: orcOut(o, extra) });
      }
      if (m !== 'POST' || !mt[2]) throw fail(404, 'Não encontrado');
      const b = await readBody(req);

      if (mt[2] === '/cancelar') {
        if (papel !== 'pintor') throw fail(403, 'Sem permissão');
        const r = await db.run("UPDATE orcamentos SET status='cancelado' WHERE id=? AND status='enviado'", [o.id]);
        if (r.changes !== 1) throw fail(409, 'Este orçamento não pode mais ser cancelado');
        return json(res, 200, { ok: true });
      }
      if (papel !== 'cliente') throw fail(403, 'Quem aprova ou recusa é o solicitante do serviço');
      if (mt[2] === '/recusar') {
        const r = await db.run("UPDATE orcamentos SET status='recusado' WHERE id=? AND status='enviado'", [o.id]);
        if (r.changes !== 1) throw fail(409, 'Esta proposta não está mais disponível');
        return json(res, 200, { ok: true });
      }
      // aprovar
      if (b.aceite !== true) throw fail(400, 'Marque o aceite para aprovar');
      if (expirou(o)) throw fail(409, 'Esta proposta expirou. Peça uma nova ao pintor.');
      const fechou = await db.run("UPDATE pedidos SET status='fechado' WHERE id=? AND status='aberto'", [ped.id]);
      if (fechou.changes !== 1) throw fail(409, 'Este pedido já foi fechado');
      const dono = await db.get('SELECT nome,whats FROM users WHERE id=?', [user.id]);
      const r = await db.run("UPDATE orcamentos SET status='aprovado',aprovado_em=?,aprovado_por=?,cliente_whats=? WHERE id=? AND status='enviado'", [now(), dono.nome, dono.whats, o.id]);
      if (r.changes !== 1) { await db.run("UPDATE pedidos SET status='aberto' WHERE id=?", [ped.id]); throw fail(409, 'Esta proposta não está mais disponível'); }
      await db.run("UPDATE orcamentos SET status='recusado' WHERE pedido_id=? AND id<>? AND status='enviado'", [ped.id, o.id]);
      const pintor = await db.get('SELECT nome,whats FROM users WHERE id=?', [o.user_id]);
      const texto = gerarContrato(o, pintor, `${dono.nome} - WhatsApp ${fmtPhone(dono.whats)}`, dono.nome);
      await db.run('INSERT INTO contratos (id,orcamento_id,texto,criado) VALUES (?,?,?,?)', [uid(), o.id, texto, now()]);
      return json(res, 200, { ok: true });
    }

    throw fail(404, 'Não encontrado');
  }

  // ---------- arquivos e páginas ----------
  function sendFile(res, file, csp) {
    const ext = path.extname(file).toLowerCase();
    if (!MIME[ext]) return send(res, 404, 'Não encontrado');
    fs.readFile(file, (e, buf) => {
      if (e) return send(res, 404, 'Não encontrado', { 'Content-Type': 'text/plain; charset=utf-8' });
      send(res, 200, buf, { 'Content-Type': MIME[ext], 'Cache-Control': 'no-cache', 'Content-Security-Policy': csp });
    });
  }

  async function adminPage(req, res, url) {
    const senha = process.env.ADMIN_SENHA;
    if (!senha) return send(res, 403, 'Painel desativado: defina ADMIN_SENHA', { 'Content-Type': 'text/plain; charset=utf-8' });
    if (limited('adm:' + ipOf(req), 20, 600000)) return send(res, 429, 'Muitas tentativas', { 'Content-Type': 'text/plain; charset=utf-8' });
    if (!equalSafe(url.searchParams.get('senha') || '', senha)) return send(res, 401, 'Acesso negado', { 'Content-Type': 'text/plain; charset=utf-8' });
    const leads = await db.all('SELECT * FROM leads ORDER BY criado DESC LIMIT 500');
    const n = async t => Number((await db.get(`SELECT COUNT(*) AS n FROM ${t}`)).n);
    const rows = leads.map(x => `<tr><td>${esc(x.criado.slice(0, 16).replace('T', ' '))}</td><td>${esc(x.nome)}</td><td><a href="https://wa.me/${esc(x.whats.replace(/\D/g, ''))}" style="color:#6aa2ff">${esc(x.whats)}</a></td><td>${esc(x.perfil)}</td><td>${esc(x.msg)}</td></tr>`).join('');
    send(res, 200, `<meta charset="utf-8"><meta name=viewport content="width=device-width"><body style="font-family:sans-serif;background:#0b0f1a;color:#fff;padding:12px"><h2>Roccan - painel</h2><p>Usuários: ${await n('users')} | Pedidos: ${await n('pedidos')} | Orçamentos: ${await n('orcamentos')} | Contratos: ${await n('contratos')}</p><h3>Contatos do site</h3><table border=1 cellpadding=6 style="border-collapse:collapse;font-size:14px"><tr><th>Data</th><th>Nome</th><th>WhatsApp</th><th>Perfil</th><th>Mensagem</th></tr>${rows}</table>`,
      { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': CSP_SITE });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      const p = url.pathname;
      if (p === '/healthz') return send(res, 200, 'ok', { 'Content-Type': 'text/plain' });
      if (p.startsWith('/api/')) {
        if (req.method !== 'GET' && req.headers.origin) {
          let okOrigin = false; try { okOrigin = new URL(req.headers.origin).host === req.headers.host; } catch { /* inválido */ }
          if (!okOrigin) return json(res, 403, { erro: 'Origem não permitida' });
        }
        return await api(req, res, url);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método não permitido');
      if (p === '/admin') return await adminPage(req, res, url);
      if (p === '/app' || p === '/app/' || /^\/o\/[A-Za-z0-9_-]{20,64}$/.test(p)) return sendFile(res, path.join(PUB, 'app.html'), CSP_APP);
      if (p === '/privacidade') return sendFile(res, path.join(PUB, 'privacidade.html'), CSP_APP);
      if (p === '/termos') return sendFile(res, path.join(PUB, 'termos.html'), CSP_APP);
      let dec; try { dec = decodeURIComponent(p); } catch { return send(res, 400, 'Requisição inválida'); }
      if (dec.includes('\0') || dec.split('/').some(s => s.startsWith('.'))) return send(res, 404, 'Não encontrado');
      if (dec.endsWith('/')) dec += 'index.html';
      const f = path.join(PUB, dec);
      if (!f.startsWith(PUB + path.sep)) return send(res, 404, 'Não encontrado');
      return sendFile(res, f, f.endsWith('app.js') || f.endsWith('app.css') ? CSP_APP : CSP_SITE);
    } catch (e) {
      if (res.headersSent) return res.end();
      if (e.status) return json(res, e.status, { erro: e.message });
      console.error('Erro interno:', e && e.message);
      return json(res, 500, { erro: 'Erro interno. Tente de novo.' });
    }
  });

  return { server, db, close: () => new Promise(r => { clearInterval(prune); server.close(() => { Promise.resolve(db.close()).then(r, r); }); }) };
}

if (require.main === module) {
  if (PROD && !process.env.DATABASE_URL && !process.env.ALLOW_SQLITE) {
    console.error('DATABASE_URL não definido: no Render o disco é apagado a cada atualização, então os dados seriam perdidos. Configure o Postgres.');
    process.exit(1);
  }
  createApp().then(app => {
    const port = process.env.PORT || 3000;
    app.server.listen(port, () => console.log('Roccan no ar: porta ' + port + ' (banco: ' + app.db.kind + ')'));
    process.on('SIGTERM', () => app.close().then(() => process.exit(0)));
  }).catch(e => { console.error('Falha ao iniciar:', e.message); process.exit(1); });
}

module.exports = { createApp };
