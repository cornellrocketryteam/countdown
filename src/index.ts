export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  CONFIG_PASSWORD: string;
}

// ---- DB row shapes -------------------------------------------------------

interface EventRow    { id: number; countdownTo: string; refreshFreq: number; event: string; active: number; }
interface MessageRow  { header: string; body: string; img: string; qrCode: string; }
interface BirthdayRow { id: number; fname: string; birthday: string; }
interface StreamRow   { id: number; url: string; title: string | null; active: number; }

// ---- Helpers -------------------------------------------------------------

const jsonOK = (data: unknown, extraHeaders: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });

const jsonErr = (status: number, message: string): Response =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

async function authToken(password: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function isAuthed(request: Request, token: string): boolean {
  const cookie = request.headers.get('Cookie') ?? '';
  const m = cookie.match(/(?:^|;\s*)cfg_auth=([^;]+)/);
  return m ? m[1] === token : false;
}

function joinNames(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return names.slice(0, -1).join(', ') + ' & ' + names[names.length - 1];
}

function extractId(path: string): string | null {
  const m = path.match(/\/(\d+)$/);
  return m ? m[1] : null;
}

// ---- Index: inject countdown data into index.html -----------------------

async function handleIndex(request: Request, env: Env): Promise<Response> {
  const origin = new URL(request.url).origin;

  let countdownTo = '2000-01-01T00:00:00Z';
  let refreshFreq = 300000;
  let event       = '';

  const ev = await env.DB.prepare(
    'SELECT countdownTo, refreshFreq, event FROM events WHERE active = 1'
  ).first<EventRow>();
  if (ev) { countdownTo = ev.countdownTo; refreshFreq = ev.refreshFreq; event = ev.event; }

  let showMessage      = false;
  let header           = '';
  let body             = '';
  let backgroundImage  = '';
  let showQrCode       = false;
  let qrCodeImage      = '';
  let showStream       = false;
  let streamUrl        = '';
  let streamTitle      = '';

  // Streams take priority over messages and birthdays
  const stream = await env.DB.prepare(
    'SELECT url, title FROM streams WHERE active = 1'
  ).first<StreamRow>();

  if (stream) {
    showStream  = true;
    streamUrl   = stream.url;
    streamTitle = stream.title ?? '';
  } else {
  const msg = await env.DB.prepare(
    'SELECT header, body, img, qrCode FROM messages WHERE active = 1'
  ).first<MessageRow>();

  if (msg) {
    showMessage     = true;
    header          = msg.header ?? '';
    body            = msg.body   ?? '';
    backgroundImage = msg.img    ?? '';
    if (msg.qrCode) {
      showQrCode   = true;
      qrCodeImage  = `https://api.qrserver.com/v1/create-qr-code/?size=512x512&data=${encodeURIComponent(msg.qrCode)}`;
    }
  } else {
    // Check birthdays in America/New_York
    const ny      = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
    const nyDate  = new Date(ny);
    const today   = `${String(nyDate.getMonth() + 1).padStart(2, '0')}-${String(nyDate.getDate()).padStart(2, '0')}`;

    const { results: bds } = await env.DB.prepare(
      'SELECT fname FROM birthdays WHERE birthday = ?'
    ).bind(today).all<{ fname: string }>();

    if (bds && bds.length > 0) {
      header          = `Happy birthday ${joinNames(bds.map(r => r.fname))}!`;
      showMessage     = true;
      backgroundImage = 'static/birthday.jpg';
    }
  }
  }

  const data = {
    generatedAt:  new Date().toISOString(),
    countdownTo,
    refreshFreq,
    event,
    showMessage,
    specialMessage: '',
    message: { header, body, backgroundImage, showQrCode, qrCodeImage },
    showStream,
    streamUrl,
    streamTitle,
  };

  const asset = await env.ASSETS.fetch(`${origin}/index.html`);
  if (!asset.ok) return new Response('page unavailable', { status: 500 });

  const html = (await asset.text()).replace('__COUNTDOWN_DATA__', JSON.stringify(data));
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// ---- Auth ----------------------------------------------------------------

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { password?: string };
  if (!body || body.password !== env.CONFIG_PASSWORD) return jsonErr(401, 'incorrect password');
  const token = await authToken(env.CONFIG_PASSWORD);
  return jsonOK({ ok: true }, { 'Set-Cookie': `cfg_auth=${token}; Path=/; HttpOnly; SameSite=Strict` });
}

function handleLogout(): Response {
  return jsonOK({ ok: true }, { 'Set-Cookie': 'cfg_auth=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' });
}

// ---- Birthday API --------------------------------------------------------

async function listBirthdays(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT id, fname, birthday FROM birthdays ORDER BY birthday'
  ).all<BirthdayRow>();
  return jsonOK(results ?? []);
}

async function addBirthday(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { fname?: string; birthday?: string };
  if (!body?.fname || !body?.birthday) return jsonErr(400, 'fname and birthday required');
  await env.DB.prepare('INSERT INTO birthdays (fname, birthday) VALUES (?, ?)').bind(body.fname, body.birthday).run();
  const row = await env.DB.prepare(
    'SELECT id, fname, birthday FROM birthdays WHERE fname = ? AND birthday = ? ORDER BY id DESC LIMIT 1'
  ).bind(body.fname, body.birthday).first<BirthdayRow>();
  return jsonOK(row ?? { fname: body.fname, birthday: body.birthday });
}

async function updateBirthday(request: Request, env: Env, id: string): Promise<Response> {
  const body = await request.json() as { fname?: string; birthday?: string };
  if (!body?.fname || !body?.birthday) return jsonErr(400, 'fname and birthday required');
  await env.DB.prepare('UPDATE birthdays SET fname = ?, birthday = ? WHERE id = ?').bind(body.fname, body.birthday, id).run();
  return jsonOK({ id, fname: body.fname, birthday: body.birthday });
}

async function deleteBirthday(env: Env, id: string): Promise<Response> {
  await env.DB.prepare('DELETE FROM birthdays WHERE id = ?').bind(id).run();
  return jsonOK({ ok: true });
}

// ---- Event API -----------------------------------------------------------

async function listEvents(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT id, countdownTo, refreshFreq, event, active FROM events ORDER BY id'
  ).all<EventRow>();
  return jsonOK(results ?? []);
}

async function addEvent(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { event?: string; countdownTo?: string; refreshFreq?: number; active?: number };
  if (!body?.event) return jsonErr(400, 'event name required');
  const refreshFreq = body.refreshFreq || 60000;
  await env.DB.prepare(
    'INSERT INTO events (countdownTo, event, refreshFreq, active) VALUES (?, ?, ?, ?)'
  ).bind(body.countdownTo ?? '', body.event, refreshFreq, body.active ?? 0).run();
  return jsonOK({ ok: true });
}

async function updateEvent(request: Request, env: Env, id: string): Promise<Response> {
  const body = await request.json() as { event?: string; countdownTo?: string; refreshFreq?: number; active?: number };
  const refreshFreq = body?.refreshFreq || 60000;
  await env.DB.prepare(
    'UPDATE events SET countdownTo = ?, event = ?, refreshFreq = ?, active = ? WHERE id = ?'
  ).bind(body?.countdownTo ?? '', body?.event ?? '', refreshFreq, body?.active ?? 0, id).run();
  return jsonOK({ ok: true });
}

async function deleteEvent(env: Env, id: string): Promise<Response> {
  await env.DB.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
  return jsonOK({ ok: true });
}

// ---- Stream API ----------------------------------------------------------

async function listStreams(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT id, url, title, active FROM streams ORDER BY id'
  ).all<StreamRow>();
  return jsonOK(results ?? []);
}

async function addStream(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { url?: string; title?: string; active?: number };
  if (!body?.url) return jsonErr(400, 'url required');
  await env.DB.prepare(
    'INSERT INTO streams (url, title, active) VALUES (?, ?, ?)'
  ).bind(body.url, body.title ?? '', body.active ?? 0).run();
  return jsonOK({ ok: true });
}

async function updateStream(request: Request, env: Env, id: string): Promise<Response> {
  const body = await request.json() as { url?: string; title?: string; active?: number };
  if (!body?.url) return jsonErr(400, 'url required');
  await env.DB.prepare(
    'UPDATE streams SET url = ?, title = ?, active = ? WHERE id = ?'
  ).bind(body.url, body.title ?? '', body.active ?? 0, id).run();
  return jsonOK({ ok: true });
}

async function deleteStream(env: Env, id: string): Promise<Response> {
  await env.DB.prepare('DELETE FROM streams WHERE id = ?').bind(id).run();
  return jsonOK({ ok: true });
}

// ---- Router --------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;

    if (path === '/'       && method === 'GET')  return handleIndex(request, env);
    if (path === '/config' && method === 'GET')  return env.ASSETS.fetch(new Request(`${url.origin}/config.html`));
    if (path === '/config/login'  && method === 'POST') return handleLogin(request, env);
    if (path === '/config/logout' && method === 'POST') return handleLogout();

    if (path.startsWith('/api/')) {
      const token = await authToken(env.CONFIG_PASSWORD);
      if (!isAuthed(request, token)) return jsonErr(401, 'unauthorized');

      const id = extractId(path);

      if (path === '/api/birthdays'        && method === 'GET')    return listBirthdays(env);
      if (path === '/api/birthdays'        && method === 'POST')   return addBirthday(request, env);
      if (path.startsWith('/api/birthdays/') && method === 'PUT'  && id) return updateBirthday(request, env, id);
      if (path.startsWith('/api/birthdays/') && method === 'DELETE' && id) return deleteBirthday(env, id);

      if (path === '/api/events'           && method === 'GET')    return listEvents(env);
      if (path === '/api/events'           && method === 'POST')   return addEvent(request, env);
      if (path.startsWith('/api/events/')  && method === 'PUT'   && id) return updateEvent(request, env, id);
      if (path.startsWith('/api/events/')  && method === 'DELETE' && id) return deleteEvent(env, id);

      if (path === '/api/streams'          && method === 'GET')    return listStreams(env);
      if (path === '/api/streams'          && method === 'POST')   return addStream(request, env);
      if (path.startsWith('/api/streams/') && method === 'PUT'   && id) return updateStream(request, env, id);
      if (path.startsWith('/api/streams/') && method === 'DELETE' && id) return deleteStream(env, id);

      return jsonErr(404, 'not found');
    }

    return env.ASSETS.fetch(request);
  },
};
