// Verifies the container-style deployment shape: actuator on a SEPARATE management port, API on the main port.
// Usage: node scripts/check-management-port.mjs [--main http://localhost:18180] [--mgmt http://localhost:18181]
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const MAIN = opt('--main', 'http://localhost:18180');
const MGMT = opt('--mgmt', 'http://localhost:18181');
const get = async (url) => { try { const r = await fetch(url); return { status: r.status, text: await r.text() }; } catch (e) { return { status: 0, text: String(e) }; } };

for (let i = 0; i < 60; i++) { if ((await get(`${MGMT}/actuator/health/readiness`)).status === 200) break; await new Promise((r) => setTimeout(r, 2000)); }
const checks = [];
const ok = (name, cond, extra = '') => { checks.push(cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`); };
const ready = await get(`${MGMT}/actuator/health/readiness`);
ok('management port serves readiness', ready.status === 200 && ready.text.includes('UP'), ready.text);
const live = await get(`${MGMT}/actuator/health/liveness`);
ok('management port serves liveness', live.status === 200 && live.text.includes('UP'));
const prom = await get(`${MGMT}/actuator/prometheus`);
ok('management port serves prometheus', prom.status === 200 && prom.text.includes('jvm_memory_used_bytes'));
const mainProm = await get(`${MAIN}/actuator/prometheus`);
ok('main (public) port does NOT serve actuator', [401, 403, 404].includes(mainProm.status), `status ${mainProm.status}`);
const api = await get(`${MAIN}/api/v1/accounts`);
ok('API on the main port still enforces authentication', api.status === 401, `status ${api.status}`);
process.exit(checks.every(Boolean) ? 0 : 1);
