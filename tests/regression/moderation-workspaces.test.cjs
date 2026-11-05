const { test } = require('node:test');
const assert = require('node:assert/strict');
const { workerRuntime, sqlStorage } = require('./worker-runtime.cjs');

function questionFixture(t, settings = {}) {
  const runtime = workerRuntime();
  const room = Object.create(runtime.Room.prototype);
  room.sql = sqlStorage();
  t.after(() => room.sql.db.close());
  room.migrate();
  room.ev = { settings: { ...runtime.settings, moderation: true, profanity: 'off', ...settings }, rooms: [], api: { webhook: null } };
  room.prints = new Map();
  room.dirtyQ = new Set();
  room.scheduleFlush = () => {};
  room.sql.exec("INSERT INTO questions(id,text,pid,ts,status) VALUES(?,?,?,?,?)", 'q1', 'Original question', 'author', 1, 'pending');
  return room;
}

function edit(room, role = 'attendee', text = 'Replacement question') {
  room.handleAudience({ type: 'editQuestion', id: 'q1', text }, 'author', role);
  return room.sql.exec('SELECT * FROM questions WHERE id = ?', 'q1').one();
}

test('approved attendee replacement requires approval and disappears from other attendees', t => {
  const room = questionFixture(t);
  room.handleModeration({ type: 'approve', id: 'q1' });
  const q = edit(room);
  assert.equal(q.text, 'Replacement question');
  assert.equal(q.status, 'pending');
  assert.equal(q.edited, 1);
  assert.equal(room.questionVisible(q, 'attendee', 'other'), false);
  assert.equal(room.questionVisible(q, 'attendee', 'author'), true);
  assert.equal(room.questionVisible(q, 'mod'), true);
  assert.equal(room.dirtyQ.has(q.id), true);
  room.handleModeration({ type: 'approve', id: q.id });
  assert.equal(room.questionVisible(room.sql.exec('SELECT * FROM questions WHERE id = ?', q.id).one(), 'attendee', 'other'), true);
});

for (const role of ['host', 'mod']) test(`${role} can edit their own approved question without reapproval`, t => {
  const room = questionFixture(t, { profanity: 'review', blockedWords: ['replacement'] });
  room.handleModeration({ type: 'approve', id: 'q1' });
  assert.equal(edit(room, role).status, 'live');
});

test('unmoderated approved attendee edit stays live', t => {
  const room = questionFixture(t, { moderation: false });
  room.handleModeration({ type: 'approve', id: 'q1' });
  assert.equal(edit(room).status, 'live');
});

test('profanity review still returns an unmoderated edited question to pending', t => {
  const room = questionFixture(t, { moderation: false, profanity: 'review', blockedWords: ['replacement'] });
  room.handleModeration({ type: 'approve', id: 'q1' });
  assert.equal(edit(room).status, 'pending');
});

test('pending question stays pending when moderation was subsequently disabled', t => {
  const room = questionFixture(t, { moderation: false });
  assert.equal(edit(room).status, 'pending');
});

test('question author check is retained', t => {
  const room = questionFixture(t);
  assert.throws(() => room.handleAudience({ type: 'editQuestion', id: 'q1', text: 'Other text' }, 'other', 'attendee'), /own questions/);
  assert.equal(room.sql.exec('SELECT text FROM questions WHERE id = ?', 'q1').one().text, 'Original question');
});

async function workspaceFixture(t, role = 'editor', plan = 'pro') {
  const runtime = workerRuntime();
  const sql = sqlStorage();
  t.after(() => sql.db.close());
  const ws = new runtime.Ws({ storage: { sql } }, {});
  const id = '1111111111111111';
  await ws.create(id, 'My workspace', 'owner@example.com');
  sql.exec('INSERT INTO members(email,role,added_at) VALUES(?,?,?)', 'member@example.com', role, 1);
  await ws.setPlan(plan);
  const effects = [];
  const env = {
    WORKSPACES: { getByName: () => ws },
    EVENTS: { getByName: code => ({ setPlan: async plan => effects.push({ code, plan }) }) },
  };
  runtime.session = async () => ({ email: 'member@example.com', stub: { setWorkspace: async () => true } });
  const remove = code => {
    const parts = ['api', 'workspaces', id, 'events', code];
    const url = new URL(`https://rslide.example/${parts.join('/')}`);
    return runtime.routes(new Request(url, { method: 'DELETE' }), env, url, parts);
  };
  return { ws, sql, effects, remove };
}

test('absent event is rejected before any unrelated event plan can change', async t => {
  const { remove, effects } = await workspaceFixture(t);
  const response = await remove('VICTIM');
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /isn't in this workspace/);
  assert.deepEqual(effects, []);
});

test('editor can remove a real event exactly once and change only that event', async t => {
  const { ws, remove, effects, sql } = await workspaceFixture(t);
  await ws.addEvent('owner@example.com', { code: 'MINE', title: 'Mine', hostKey: 'host-secret' });
  assert.equal((await remove('MINE')).status, 200);
  assert.equal(sql.exec('SELECT COUNT(*) AS n FROM events').one().n, 0);
  assert.deepEqual(effects, [{ code: 'MINE', plan: 'free' }]);
  assert.equal((await remove('MINE')).status, 400);
  assert.equal(effects.length, 1);
});

test('viewer cannot remove a listed event or change its plan', async t => {
  const { ws, remove, effects, sql } = await workspaceFixture(t, 'viewer');
  await ws.addEvent('owner@example.com', { code: 'MINE', title: 'Mine', hostKey: 'host-secret' });
  assert.equal((await remove('MINE')).status, 400);
  assert.equal(sql.exec('SELECT COUNT(*) AS n FROM events').one().n, 1);
  assert.deepEqual(effects, []);
});

test('removing from a free workspace does not mutate any event plan', async t => {
  const { ws, remove, effects } = await workspaceFixture(t, 'editor', 'free');
  await ws.addEvent('owner@example.com', { code: 'MINE', title: 'Mine', hostKey: 'host-secret' });
  assert.equal((await remove('MINE')).status, 200);
  assert.deepEqual(effects, []);
});
