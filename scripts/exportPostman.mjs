// Converts the v3 collection (YAML per request) and environment into Postman v2.1 JSON for app import.
// Usage: npm run postman:export  (regenerate after editing postman/collections or postman/environments)
// The Postman CLI has no v3 → v2.1 export, and the Postman app imports v2.1 JSON.
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

/** Stable id from a name, so regenerating does not change the files (and re-import updates instead of duplicating). */
const stableId = (name) => {
    const h = createHash('sha256').update(name).digest('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const root = process.argv[2] ?? process.cwd();
const require = createRequire(join(root, 'package.json'));
const YAML = require('yaml');
const load = (p) => YAML.parse(readFileSync(p, 'utf8'));

const auth = (a) => {
    if (!a) return undefined;
    if (a.type === 'noauth') return { type: 'noauth' };
    const creds = Array.isArray(a.credentials) ? a.credentials : Object.entries(a.credentials).map(([key, value]) => ({ key, value }));
    return { type: a.type, [a.type]: creds.map(({ key, value }) => ({ key, value, type: 'string' })) };
};

const events = (scripts, prefix) => (scripts ?? []).map((s) => ({
    listen: s.type.replace(prefix, '') === 'beforeRequest' ? 'prerequest' : 'test',
    script: { type: 'text/javascript', exec: s.code.split('\n') },
}));

const definition = (dir) => {
    const p = join(dir, '.resources', 'definition.yaml');
    return existsSync(p) ? load(p) : {};
};

function convertRequest(file) {
    const r = load(file);
    const name = r.name ?? file.split('/').pop().replace(/\.request\.yaml$/, '');
    const request = {
        method: r.method,
        header: (r.headers ?? []).map(({ key, value }) => ({ key, value })),
        url: r.url,
    };
    if (r.description) request.description = r.description;
    if (r.auth) request.auth = auth(r.auth);
    if (r.body && r.body.type !== 'none') {
        request.body = r.body.type === 'json'
            ? { mode: 'raw', raw: r.body.content, options: { raw: { language: 'json' } } }
            : { mode: 'raw', raw: r.body.content, options: { raw: { language: 'text' } } };
    }
    const item = { name, request };
    const ev = events(r.scripts, '');
    if (ev.length) item.event = ev;
    return { order: r.order ?? 0, item };
}

function convertFolder(dir) {
    const def = definition(dir);
    const children = [];
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (entry === '.resources') continue;
        if (statSync(p).isDirectory()) children.push(convertFolder(p));
        else if (entry.endsWith('.request.yaml')) children.push(convertRequest(p));
    }
    children.sort((a, b) => a.order - b.order);
    const item = { name: def.name ?? dir.split('/').pop(), item: children.map((c) => c.item) };
    if (def.description) item.description = def.description;
    if (def.auth) item.auth = auth(def.auth);
    const ev = events(def.scripts, 'http:');
    if (ev.length) item.event = ev;
    return { order: def.order ?? 0, item };
}

const colDir = join(root, 'postman', 'collections', 'Wedding Album API');
const { item: top } = convertFolder(colDir);
const collection = {
    info: {
        _postman_id: stableId(`collection:${top.name}`),
        name: top.name,
        description: top.description,
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: top.item,
    ...(top.auth && { auth: top.auth }),
    ...(top.event && { event: top.event }),
};

const env = load(join(root, 'postman', 'environments', 'Local.environment.yaml'));
const environment = {
    id: stableId(`environment:${env.name}`),
    name: env.name,
    values: env.values.map((v) => ({ key: v.key, value: v.value, type: v.type === 'secret' ? 'secret' : 'default', enabled: v.enabled !== false })),
    _postman_variable_scope: 'environment',
};

const out = join(root, 'postman', 'import');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'Wedding Album API.postman_collection.json'), JSON.stringify(collection, null, 2) + '\n');
writeFileSync(join(out, 'Local.postman_environment.json'), JSON.stringify(environment, null, 2) + '\n');
console.log('requests:', JSON.stringify(collection).match(/"method"/g).length);
