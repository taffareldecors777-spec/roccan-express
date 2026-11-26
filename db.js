'use strict';
// Banco de dados: Postgres quando existir DATABASE_URL (produção), SQLite local caso contrário (testes/dev).
const path = require('path');
const fs = require('fs');

const conv = sql => { let i = 0; return sql.replace(/\?/g, () => '$' + (++i)); };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, nome TEXT NOT NULL, email TEXT NOT NULL UNIQUE, whats TEXT NOT NULL,
  papel TEXT NOT NULL, senha_hash TEXT NOT NULL, criado TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expira TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pedidos (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, titulo TEXT NOT NULL, tipo TEXT NOT NULL,
  cidade TEXT NOT NULL, descricao TEXT NOT NULL, status TEXT NOT NULL, criado TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orcamentos (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, pedido_id TEXT, token TEXT NOT NULL UNIQUE,
  cliente_nome TEXT NOT NULL, cliente_whats TEXT NOT NULL, titulo TEXT NOT NULL,
  itens TEXT NOT NULL, total INTEGER NOT NULL, validade_dias INTEGER NOT NULL, obs TEXT NOT NULL,
  status TEXT NOT NULL, aprovado_em TEXT, aprovado_por TEXT, criado TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS contratos (
  id TEXT PRIMARY KEY, orcamento_id TEXT NOT NULL UNIQUE, texto TEXT NOT NULL, criado TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY, nome TEXT NOT NULL, whats TEXT NOT NULL, perfil TEXT NOT NULL,
  msg TEXT NOT NULL, criado TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orc_user ON orcamentos(user_id);
CREATE INDEX IF NOT EXISTS idx_orc_pedido ON orcamentos(pedido_id);
CREATE INDEX IF NOT EXISTS idx_ped_user ON pedidos(user_id);
CREATE INDEX IF NOT EXISTS idx_sess_user ON sessions(user_id);
`;

async function open(opts = {}) {
  const url = opts.databaseUrl !== undefined ? opts.databaseUrl : process.env.DATABASE_URL;
  let db;
  if (url) {
    const { Pool } = require('pg');
    const host = new URL(url).hostname;
    const ssl = process.env.PGSSL === 'off' ? false : (process.env.PGSSL === 'on' || host.includes('.')) ? { rejectUnauthorized: false } : false;
    const pool = new Pool({ connectionString: url, ssl, max: 5 });
    db = {
      kind: 'pg',
      all: async (s, p = []) => (await pool.query(conv(s), p)).rows,
      get: async (s, p = []) => (await pool.query(conv(s), p)).rows[0],
      run: async (s, p = []) => ({ changes: (await pool.query(conv(s), p)).rowCount }),
      exec: async s => { await pool.query(s); },
      close: () => pool.end()
    };
  } else {
    const { DatabaseSync } = require('node:sqlite');
    const dir = opts.dataDir || process.env.DATA_DIR || path.join(__dirname, 'data');
    fs.mkdirSync(dir, { recursive: true });
    const s = new DatabaseSync(path.join(dir, 'roccan.db'));
    s.exec('PRAGMA journal_mode=WAL;');
    db = {
      kind: 'sqlite',
      all: async (q, p = []) => s.prepare(q).all(...p).map(r => ({ ...r })),
      get: async (q, p = []) => { const r = s.prepare(q).get(...p); return r ? { ...r } : undefined; },
      run: async (q, p = []) => ({ changes: Number(s.prepare(q).run(...p).changes) }),
      exec: async q => { s.exec(q); },
      close: () => s.close()
    };
  }
  await db.exec(SCHEMA);
  return db;
}

module.exports = { open };
