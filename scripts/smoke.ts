import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

type Step = { name: string; run: () => Promise<void> };

export async function runSmoke(baseUrl: string, log: (line: string) => void = console.log): Promise<boolean> {
  const base = baseUrl.replace(/\/+$/, '');
  const suffix = randomBytes(4).toString('hex');
  const user = { username: `smoke_${suffix}`, email: `smoke_${suffix}@example.com`, password: 'smoke-password-1' };
  let token = '';
  let demoToken = '';
  let dropId = 0;

  const call = async (method: string, path: string, options: { body?: unknown; token?: string } = {}) => {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json, headers: res.headers };
  };

  const expectStatus = (actual: number, expected: number, label: string) => {
    if (actual !== expected) throw new Error(`${label} : ${expected} attendu, ${actual} reçu`);
  };

  const steps: Step[] = [
    {
      name: '/health répond ok',
      run: async () => {
        const res = await call('GET', '/health');
        expectStatus(res.status, 200, 'GET /health');
        if (res.json?.status !== 'ok' || res.json?.db !== 'ok') throw new Error('état inattendu');
      },
    },
    {
      name: 'inscription d’un utilisateur aléatoire et connexion',
      run: async () => {
        const reg = await call('POST', '/auth/register', { body: { ...user, displayName: 'Smoke' } });
        expectStatus(reg.status, 201, 'POST /auth/register');
        const login = await call('POST', '/auth/login', { body: { login: user.username, password: user.password } });
        expectStatus(login.status, 200, 'POST /auth/login');
        token = login.json.token;
        const me = await call('GET', '/auth/me', { token });
        expectStatus(me.status, 200, 'GET /auth/me');
      },
    },
    {
      name: 'création d’un drop, like, commentaire',
      run: async () => {
        const drop = await call('POST', '/drops', {
          token,
          body: { title: 'Drop de fumée', content: 'Créé par le script de fumée.', category: 'note', lat: 47.4956, lng: 6.8054 },
        });
        expectStatus(drop.status, 201, 'POST /drops');
        dropId = drop.json.id;
        const like = await call('POST', `/drops/${dropId}/like`, { token });
        expectStatus(like.status, 200, 'POST like');
        if (like.json.likesCount !== 1) throw new Error('likesCount attendu : 1');
        const comment = await call('POST', `/drops/${dropId}/comments`, { token, body: { content: 'Test' } });
        expectStatus(comment.status, 201, 'POST comments');
      },
    },
    {
      name: 'connexion en demo et modification refusée (403)',
      run: async () => {
        const login = await call('POST', '/auth/login', { body: { login: 'demo', password: 'drops2026' } });
        expectStatus(login.status, 200, 'login demo');
        demoToken = login.json.token;
        const patch = await call('PATCH', `/drops/${dropId}`, { token: demoToken, body: { title: 'Piraté' } });
        expectStatus(patch.status, 403, 'PATCH par un autre');
      },
    },
    {
      name: 'un 422, un ?fail=500 et un ?delay=500',
      run: async () => {
        const invalid = await call('POST', '/drops', { token, body: { title: 'a' } });
        expectStatus(invalid.status, 422, 'POST /drops invalide');
        if (!invalid.json?.error?.fields?.title) throw new Error('fields.title manquant');
        const failed = await call('GET', '/drops?fail=500');
        expectStatus(failed.status, 500, '?fail=500');
        if (failed.json?.error?.simulated !== true) throw new Error('simulated: true attendu');
        const start = Date.now();
        const slow = await call('GET', '/health?delay=500');
        expectStatus(slow.status, 200, '?delay=500');
        if (Date.now() - start < 450) throw new Error('?delay=500 n’a pas retardé la réponse');
      },
    },
    {
      name: 'suppression du drop créé',
      run: async () => {
        const del = await call('DELETE', `/drops/${dropId}`, { token });
        expectStatus(del.status, 204, 'DELETE /drops/:id');
        const after = await call('GET', `/drops/${dropId}`);
        expectStatus(after.status, 404, 'GET après suppression');
      },
    },
  ];

  let ok = true;
  for (const step of steps) {
    try {
      await step.run();
      log(`✅ ${step.name}`);
    } catch (err) {
      ok = false;
      log(`❌ ${step.name} : ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return ok;
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage : npm run smoke -- https://url-deployee');
    process.exit(2);
  }
  runSmoke(url).then((ok) => process.exit(ok ? 0 : 1));
}
