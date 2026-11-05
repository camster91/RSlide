// Runs the production methods against SQLite without a live Cloudflare account.
// Node 24 supplies both TypeScript stripping and SQLite. Imports are removed:
// the needed internal modules share one VM, while edge I/O is supplied by tests.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '../..');

function workerRuntime() {
  const context = vm.createContext({
    console, crypto: globalThis.crypto, URL, Request, Response, TextEncoder, TextDecoder,
    setTimeout, clearTimeout,
    DurableObject: class { constructor(ctx, env) { this.ctx = ctx; this.env = env; } },
  });
  function load(file, expose = '') {
    const source = stripTypeScriptTypes(fs.readFileSync(path.join(root, file), 'utf8'), { mode: 'transform' })
      .replace(/^import[\s\S]*?;\n/gm, '').replace(/^export /gm, '');
    vm.runInContext(source + '\n' + expose, context, { filename: file });
  }
  load('src/shared/protocol.ts', 'globalThis.settings = DEFAULT_SETTINGS;');
  load('src/worker/logic.ts');
  load('src/worker/room.ts', 'globalThis.Room = EventRoom;');
  load('src/worker/workspace.ts', 'globalThis.Ws = Workspace;');
  load('src/worker/workspaceRoutes.ts', 'globalThis.routes = workspaceRoutes;');
  context.json = (data, status = 200) => Response.json(data, { status });
  context.sameSiteJson = () => null;
  return context;
}

function sqlStorage() {
  const db = new DatabaseSync(':memory:');
  return {
    db,
    exec(sql, ...params) {
      let rows = [];
      if (sql.trim().split(';').filter(Boolean).length > 1) db.exec(sql);
      else {
        const stmt = db.prepare(sql);
        if (stmt.columns().length) rows = stmt.all(...params);
        else stmt.run(...params);
      }
      rows.toArray = () => rows;
      rows.one = () => { if (rows.length !== 1) throw new Error('Expected exactly one SQL row'); return rows[0]; };
      return rows;
    },
  };
}

module.exports = { workerRuntime, sqlStorage };
