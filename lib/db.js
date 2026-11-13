// Database facade shared by the Node server (node:sqlite) and the Cloudflare Worker (D1).
// Every call is async:  await db.prepare(sql).get(...args) / .all(...args) / .run(...args)
// The entry point (server.js or worker.js) plugs in a driver with setDriver().
let driver = null;
export function setDriver(d) { driver = d; }
export const db = {
  prepare(sql) {
    if (!driver) throw new Error('Database driver not set');
    return driver.prepare(sql);
  },
};
export const now = () => new Date().toISOString();

// Cloudflare D1 driver.
export function d1Driver(D1) {
  return {
    prepare(sql) {
      const st = (args) => (args.length ? D1.prepare(sql).bind(...args.map((v) => (v === undefined ? null : v))) : D1.prepare(sql));
      return {
        get: async (...a) => (await st(a).first()) ?? undefined,
        all: async (...a) => (await st(a).all()).results || [],
        run: async (...a) => st(a).run(),
      };
    },
  };
}
