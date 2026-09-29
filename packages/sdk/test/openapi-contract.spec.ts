import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

/**
 * Every request the SDK makes must be an operation in Opensend's OpenAPI
 * contract, and every operation in the contract must have an SDK method, so
 * drift on either side fails here. Requests are read from the source: each
 * `this.resend.<method>(…)` call with its path literal, or with the literal
 * assigned to the `url`/`path` variable it passes.
 */

const root = join(__dirname, '..');
const spec = parse(
  readFileSync(join(root, '../../openapi/opensend.yaml'), 'utf8'),
) as { paths: Record<string, Record<string, unknown>> };

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/** Parameters become `{}`; the query string is dropped, including one
    appended through a placeholder (`/templates${query}`). */
const normalize = (path: string) =>
  path
    .replace(/\$\{[^}]*\}/g, '{}')
    .replace(/\{[^}]*\}/g, '{}')
    .split('?')[0]
    .replace(/([^/])\{\}$/, '$1');

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
      ? [path]
      : [];
  });

const firstLiteral = (text: string) =>
  text.match(/(['`])(\/[^'`]*)\1/)?.[2] ?? null;

function sdkRequests() {
  const found = new Set<string>();
  for (const file of sources(join(root, 'src'))) {
    const text = readFileSync(file, 'utf8');
    const assignments: { at: number; name: string; literal: string }[] = [];
    for (const match of text.matchAll(/const (url|path) =([\s\S]*?);/g)) {
      const literal = firstLiteral(match[2]);
      if (literal)
        assignments.push({ at: match.index, name: match[1], literal });
    }
    const calls = text.matchAll(
      /this\.resend\.(get|post|put|patch|delete)(?:<[\s\S]*?>)?\(\s*((['`])[\s\S]*?\3|\w+)/g,
    );
    for (const call of calls) {
      const [, method, argument] = call;
      const literal =
        firstLiteral(argument) ??
        assignments
          .filter((a) => a.name === argument && a.at < call.index)
          .at(-1)?.literal;
      if (!literal) throw new Error(`Unresolved request path in ${file}`);
      found.add(`${method.toUpperCase()} ${normalize(literal)}`);
    }
  }
  return found;
}

function contractOperations() {
  const found = new Set<string>();
  for (const [path, item] of Object.entries(spec.paths))
    for (const method of METHODS)
      if (item[method]) found.add(`${method.toUpperCase()} ${normalize(path)}`);
  return found;
}

/** Resend's older `contacts.*` forms that take `audienceId`. Opensend does
    not serve these routes, so the server answers 404. */
const LEGACY = new Set<string>([
  'POST /audiences/{}/contacts',
  'GET /audiences/{}/contacts/{}',
  'PATCH /audiences/{}/contacts/{}',
  'DELETE /audiences/{}/contacts/{}',
]);

/** Served operations with no SDK method of their own: the SMTP gateway's
    bridge, and the deprecated `/audiences` aliases (the SDK's `audiences`
    is the segments client, which calls `/segments`). */
const NOT_EXPOSED = new Set<string>([
  'POST /smtp/auth',
  'POST /smtp/emails',
  'POST /audiences',
  'GET /audiences',
  'GET /audiences/{}',
  'DELETE /audiences/{}',
]);

describe('OpenAPI contract', () => {
  const sdk = sdkRequests();
  const contract = contractOperations();

  it('finds the SDK requests', () => {
    expect(sdk.size).toBeGreaterThan(80);
  });

  it('every SDK request is an operation in openapi/opensend.yaml', () => {
    const missing = [...sdk].filter((op) => !contract.has(op) && !LEGACY.has(op));
    expect(missing.sort()).toEqual([]);
  });

  it('every contract operation has an SDK method', () => {
    const uncovered = [...contract].filter(
      (op) => !sdk.has(op) && !NOT_EXPOSED.has(op),
    );
    expect(uncovered.sort()).toEqual([]);
  });

  it('keeps the exception lists current', () => {
    expect([...LEGACY].filter((op) => !sdk.has(op))).toEqual([]);
    expect([...NOT_EXPOSED].filter((op) => !contract.has(op))).toEqual([]);
  });
});
