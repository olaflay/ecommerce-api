"use strict";
const dnsModule = require("node:dns");
const { Resolver } = dnsModule;

const FALLBACK_SERVERS = ["8.8.8.8", "1.1.1.1", "208.67.222.222"];
const resolver = new Resolver();
resolver.setServers(FALLBACK_SERVERS);

const memo = new Map();
const IN_FLIGHT = new Map();

function fallbackLookup(hostname, family, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("DNS fallback timeout for " + hostname));
    }, timeoutMs || 6000);
    const done = (err, addr) => {
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(addr);
    };
    if (family === 6) {
      resolver.resolve6(hostname, (err, addresses) => {
        if (err) return done(err);
        const a = addresses && addresses[0];
        a ? done(null, a) : done(new Error("no v6 for " + hostname));
      });
    } else {
      resolver.resolve4(hostname, (err, addresses) => {
        if (err) return done(err);
        const a = addresses && addresses[0];
        a ? done(null, a) : done(new Error("no v4 for " + hostname));
      });
    }
  });
}

function originalLookup(hostname, opts, cb) {
  return dnsModule.lookup(hostname, opts, cb);
}

function patchedLookup(hostname, options, callback) {
  let opts = {};
  let cb = callback;
  if (typeof options === "object" && options !== null) {
    opts = options;
  } else if (typeof options === "function") {
    cb = options;
    opts = {};
  }
  if (typeof hostname !== "string") {
    return originalLookup(hostname, opts, cb);
  }
  const host = hostname.toLowerCase();
  const family = opts.family || 0;

  if (memo.has(host)) {
    const m = memo.get(host);
    return m.ok ? cb(null, m.addr, m.fam) : originalLookup(hostname, opts, cb);
  }
  if (IN_FLIGHT.has(host)) {
    return IN_FLIGHT.get(host).push(cb) && undefined;
  }

  const callbacks = [];
  IN_FLIGHT.set(host, callbacks);
  const finish = (err, addr, fam) => {
    IN_FLIGHT.delete(host);
    memo.set(host, { ok: !err, addr, fam });
    for (const c of callbacks) c(err, addr, fam);
    cb(err, addr, fam);
  };

  originalLookup(hostname, opts, (err, addr, fam) => {
    if (!err && addr) return finish(null, addr, fam || 4);
    fallbackLookup(host, family || 4)
      .then((a) => finish(null, a, 4))
      .catch((e) => {
        memo.set(host, { ok: false });
        originalLookup(hostname, opts, cb);
      });
  });
}

dnsModule.lookup = patchedLookup;
try { dnsModule.promises.lookup = (h, o) => new Promise((res, rej) => patchedLookup(h, o, (e, a, f) => e ? rej(e) : res({ address: a, family: f }))); } catch (e) {}

module.exports = { FALLBACK_SERVERS };
