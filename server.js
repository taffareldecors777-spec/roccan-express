const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ====== CONFIGURAÇÕES (mude aqui ou nas variáveis de ambiente) ======
const WHATS = process.env.WHATS || '5547999732214';      // 55 + DDD + número
const BASE_URL = process.env.BASE_URL || '';             // ex: https://roccan.onrender.com
const MP_TOKEN = process.env.MP_TOKEN || '';             // token do Mercado Pago (opcional)
const PLANOS = [                                          // PREÇOS DE EXEMPLO: ajuste os seus
  { id: 'pintor', nome: 'Pintor', preco: 9.9, desc: 'Orçamentos, contratos e recebimento no app. Mais clientes.' },
  { id: 'sindico', nome: 'Síndico', preco: 9.9, desc: 'Compare orçamentos e acompanhe a obra do condomínio.' },
  { id: 'administradora', nome: 'Administradora', preco: 9.9, desc: 'Gestão de vários condomínios, prazos e controle de custos.' }
];
// ====================================================================

const F = path.join(__dirname, 'leads.json');
const ler = () => { try { return JSON.parse(fs.readFileSync(F)); } catch (e) { return []; } };
const salvar = l => fs.writeFileSync(F, JSON.stringify(l, null, 2));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const add = (nome, whats, perfil, msg) => {
  const l = ler();
  l.push({
    nome: String(nome).slice(0, 100), whats: String(whats).slice(0, 30),
    perfil: String(perfil || '').slice(0, 60), msg: String(msg || '').slice(0, 500),
    data: new Date().toISOString()
  });
  salvar(l);
};

app.get('/api/config', (req, res) => res.json({ whats: WHATS, planos: PLANOS }));

app.post('/api/lead', (req, res) => {
  const { nome, whats, perfil, msg } = req.body || {};
  if (!nome || !whats) return res.status(400).json({ erro: 'Preencha nome e WhatsApp' });
  add(nome, whats, perfil, msg);
  res.json({ ok: true });
});

app.post('/api/checkout', async (req, res) => {
  const { plano, nome, whats } = req.body || {};
  const p = PLANOS.find(x => x.id === plano);
  if (!p || !nome || !whats) return res.status(400).json({ erro: 'Preencha nome, WhatsApp e escolha o plano' });
  add(nome, whats, 'Assinatura: ' + p.nome, 'Quer assinar o plano ' + p.nome);
  if (!MP_TOKEN || !BASE_URL) return res.json({ modo: 'whatsapp', plano: p.nome });
  try {
    const r = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + MP_TOKEN },
      body: JSON.stringify({
        items: [{ title: 'Roccan Soluções - Plano ' + p.nome, quantity: 1, currency_id: 'BRL', unit_price: p.preco }],
        back_urls: { success: BASE_URL + '/?pago=1', failure: BASE_URL + '/?pago=0', pending: BASE_URL + '/?pago=2' },
        auto_return: 'approved'
      })
    });
    const d = await r.json();
    if (!d.init_point) throw new Error('sem init_point');
    res.json({ modo: 'pagar', url: d.init_point });
  } catch (e) {
    res.json({ modo: 'whatsapp', plano: p.nome });
  }
});

app.get('/admin', (req, res) => {
  if (req.query.senha !== (process.env.ADMIN_SENHA || 'troque-esta-senha')) return res.status(401).send('Acesso negado');
  const rows = ler().reverse().map(x =>
    `<tr><td>${esc(x.data.slice(0, 16).replace('T', ' '))}</td><td>${esc(x.nome)}</td>` +
    `<td><a href="https://wa.me/${esc(x.whats.replace(/\D/g, ''))}" style="color:#6aa2ff">${esc(x.whats)}</a></td>` +
    `<td>${esc(x.perfil)}</td><td>${esc(x.msg)}</td></tr>`).join('');
  res.send(`<meta name=viewport content="width=device-width"><body style="font-family:sans-serif;background:#0b0f1a;color:#fff;padding:12px"><h2>Contatos Roccan</h2><table border=1 cellpadding=6 style="border-collapse:collapse;font-size:14px"><tr><th>Data</th><th>Nome</th><th>WhatsApp</th><th>Perfil</th><th>Mensagem</th></tr>${rows}</table>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Roccan no ar: http://localhost:' + PORT));
