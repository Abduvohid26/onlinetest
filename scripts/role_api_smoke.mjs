#!/usr/bin/env node
/**
 * 3 rol API smoke: admin, staff, student — asosiy endpointlar.
 * UI_BASE=http://127.0.0.1:8080 node scripts/role_api_smoke.mjs
 */
const BASE = (process.env.UI_BASE || 'http://127.0.0.1:8080').replace(/\/$/, '');
const PASS = process.env.SMOKE_PASS || 'DemoFJSTI2026!';

const USERS = [
  { id: 'demo_admin', role: 'admin' },
  { id: 'demo_staff', role: 'staff' },
  { id: 'demo_student', role: 'student' },
];

const ROLE_ENDPOINTS = {
  admin: [
    ['GET', '/api/admin/stats'],
    ['GET', '/api/admin/groups'],
    ['GET', '/api/admin/levels'],
    ['GET', '/api/admin/users'],
    ['GET', '/api/admin/audit-log?limit=5'],
    ['GET', '/api/admin/ban-appeals'],
    ['GET', '/api/admin/review-queue?limit=5'],
    ['GET', '/api/admin/test-bank/categories'],
    ['GET', '/api/admin/exams'],
  ],
  staff: [
    ['GET', '/api/staff/exams'],
  ],
  student: [
    ['GET', '/api/student/exams'],
    ['GET', '/api/student/results'],
    ['GET', '/api/student/ban-appeals'],
  ],
};

const failures = [];
const passes = [];

async function login(id) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, password: PASS }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.token) throw new Error(`${id} login failed: ${res.status} ${j.error || ''}`);
  return j.token;
}

async function probe(token, method, path) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.status;
}

async function main() {
  console.log(`API smoke @ ${BASE}\n`);
  for (const u of USERS) {
    console.log(`── ${u.role.toUpperCase()} (${u.id}) ──`);
    let token;
    try {
      token = await login(u.id);
      passes.push(`${u.role} login`);
      console.log('  OK  login');
    } catch (e) {
      failures.push(`${u.role} login — ${e.message}`);
      console.log(`  FAIL login — ${e.message}`);
      continue;
    }
    const endpoints = ROLE_ENDPOINTS[u.role] || [];
    for (const [method, path] of endpoints) {
      const status = await probe(token, method, path);
      const ok = status >= 200 && status < 400;
      const label = `${method} ${path}`;
      if (ok) {
        passes.push(`${u.role} ${label}`);
        console.log(`  OK  ${label} → ${status}`);
      } else {
        failures.push(`${u.role} ${label} → ${status}`);
        console.log(`  FAIL ${label} → ${status}`);
      }
    }
    // Cross-role forbidden checks
    if (u.role === 'student') {
      const st = await probe(token, 'GET', '/api/admin/stats');
      if (st === 403 || st === 401) {
        passes.push('student blocked from admin');
        console.log(`  OK  student cannot access /api/admin/stats → ${st}`);
      } else {
        failures.push(`student should not access admin stats → ${st}`);
        console.log(`  FAIL student admin access → ${st}`);
      }
    }
    if (u.role === 'staff') {
      const st = await probe(token, 'GET', '/api/admin/users');
      if (st === 403 || st === 401) {
        passes.push('staff blocked from admin users');
        console.log(`  OK  staff cannot access /api/admin/users → ${st}`);
      } else {
        failures.push(`staff should not access admin users → ${st}`);
        console.log(`  FAIL staff admin users → ${st}`);
      }
    }
    console.log('');
  }

  console.log(`\n${passes.length} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(' -', f));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
