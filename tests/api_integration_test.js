/**
 * CarbonRoute Automated Integration Test Suite
 * Validates REST API, Auth Guards, Versioning Persistence, and Simulation Endpoints.
 */

const http = require('http');

const PORT = process.env.PORT || 5000;
const BASE_URL = `http://localhost:${PORT}/api`;

function request(path, options = {}, postData = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE_URL}${path}`);
    const reqOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const req = http.request(reqOptions, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        } catch {
          resolve({ status: res.statusCode, raw: body, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function runTests() {
  console.log('🧪 ========================================================');
  console.log('🧪 Running CarbonRoute Platform Automated Integration Tests');
  console.log('🧪 ========================================================');

  let passed = 0;
  let failed = 0;

  async function assertTest(name, fn) {
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${name} ->`, err.message);
      failed++;
    }
  }

  // Test 1: Health Check
  await assertTest('Backend Health Check (GET /api/health)', async () => {
    const res = await request('/health');
    if (res.status !== 200 || res.data.status !== 'healthy') {
      throw new Error(`Expected 200 healthy, got ${res.status}: ${JSON.stringify(res.data)}`);
    }
  });

  // Test 2: Public Presentations
  await assertTest('Public Presentations List (GET /api/presentations)', async () => {
    const res = await request('/presentations');
    if (res.status !== 200 || !res.data.success || !Array.isArray(res.data.data)) {
      throw new Error(`Failed to list presentations: ${res.status}`);
    }
  });

  // Test 3: Planning Presentation V1
  await assertTest('Planning Presentation V1 Retrieval (GET /api/presentations/v/v1)', async () => {
    const res = await request('/presentations/v/v1');
    if (res.status !== 200 || !res.data.success || res.data.data.versionTag !== 'v1') {
      throw new Error(`Failed to retrieve version v1: ${JSON.stringify(res.data)}`);
    }
    if (!res.data.data.sha256Checksum) {
      throw new Error('Missing sha256Checksum on version v1');
    }
  });

  // Test 4: Team Profile Query
  await assertTest('Team Profile Ingestion (GET /api/team)', async () => {
    const res = await request('/team');
    if (res.status !== 200 || !res.data.success || res.data.data.length < 3) {
      throw new Error('Expected at least 3 team members (Yuvika, Kumkum, Aaneya)');
    }
    const names = res.data.data.map((m) => m.name);
    if (!names.includes('Yuvika') || !names.includes('Kumkum') || !names.includes('Aaneya')) {
      throw new Error(`Missing expected team names: ${names.join(', ')}`);
    }
  });

  // Test 5: 10-Phase Roadmap
  await assertTest('Roadmap Milestones Ingestion (GET /api/roadmap)', async () => {
    const res = await request('/roadmap');
    if (res.status !== 200 || !res.data.success || res.data.data.length < 10) {
      throw new Error(`Expected 10 roadmap phases, got ${res.data.data?.length}`);
    }
  });

  // Test 6: Feasibility Simulator API
  await assertTest('Feasibility Decision Simulation (POST /api/scheduler/simulate)', async () => {
    const res = await request(
      '/scheduler/simulate',
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      { durationHours: 2, deadlineHours: 12, riskTolerance: 0.1 }
    );
    if (res.status !== 200 || !res.data.success || !res.data.data.scenarios) {
      throw new Error('Feasibility simulation failed');
    }
    const { scenarioA, scenarioB } = res.data.data.scenarios;
    if (scenarioA.selectedStartHour === scenarioB.selectedStartHour) {
      throw new Error('Expected different start times between Scenario A and Scenario B under uncertainty!');
    }
  });

  // Test 7: Unauthorized Upload Rejection
  await assertTest('Unauthorized Upload Rejected (POST /api/presentations/upload without token -> 401)', async () => {
    const res = await request('/presentations/upload', { method: 'POST' });
    if (res.status !== 401) {
      throw new Error(`Expected status 401 Unauthorized, got ${res.status}`);
    }
  });

  // Test 8: Admin Authentication. Credentials come from ADMIN_USERNAME / ADMIN_PASSWORD (never hardcoded);
  // without ADMIN_PASSWORD this test fails with an explanation.
  let adminToken = '';
  await assertTest('Admin Authentication (POST /api/auth/login)', async () => {
    if (!process.env.ADMIN_PASSWORD) throw new Error('Set ADMIN_PASSWORD (and optionally ADMIN_USERNAME) to the running server admin credentials.');
    const res = await request(
      '/auth/login',
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      { username: process.env.ADMIN_USERNAME || 'admin', password: process.env.ADMIN_PASSWORD }
    );
    if (res.status !== 200 || !res.data.success || !res.data.token) {
      throw new Error(`Admin login failed: ${JSON.stringify(res.data)}`);
    }
    adminToken = res.data.token;
  });

  console.log('🧪 ========================================================');
  console.log(`🧪 Results: ${passed} Passed, ${failed} Failed`);
  console.log('🧪 ========================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runTests();
}

module.exports = { runTests };
