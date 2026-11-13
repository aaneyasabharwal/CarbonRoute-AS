/**
 * [legacy] Port of tests/api_integration_test.js and tests/version_upload_test.js.
 *
 * Each assertion below is the ORIGINAL script's assertion, unchanged in meaning.
 * The originals needed a running server on port 5000 and the developer's real
 * database; these run in-process with supertest against a temporary database.
 *
 * Two original assertions cannot pass against the current code. They are kept
 * verbatim and marked `it.fails`, which passes only while the original assertion
 * still fails, so the discrepancy stays visible instead of being silently rewritten.
 * The intended, correct behaviour is tested separately in test/features/portal.test.ts.
 *
 * Only change: the original scripts logged in with the hardcoded seeded admin
 * password (audit C4). Here the login uses the per-run test admin fixture
 * (test/support/auth.ts); removing the hardcoded credential itself is task M1.1.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { loginAsTestAdmin, testAdminCredentials } from '../support/auth';

describe('[legacy] tests/api_integration_test.js', () => {
  it('Backend Health Check (GET /api/health)', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
  });

  it('Public Presentations List (GET /api/presentations)', async () => {
    const res = await request(app).get('/api/presentations');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('Planning Presentation V1 Retrieval (GET /api/presentations/v/v1)', async () => {
    const res = await request(app).get('/api/presentations/v/v1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.versionTag).toBe('v1');
    expect(res.body.data.sha256Checksum).toBeTruthy();
  });

  it('Team Profile Ingestion (GET /api/team): at least 3 members', async () => {
    const res = await request(app).get('/api/team');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(3);
  });

  // ORIGINAL ASSERTION, KNOWN TO FAIL: the script checked names.includes('Yuvika'),
  // i.e. an exact array element equal to the first name. The API returns full
  // names ('Yuvika Nagpal', ...), so this check has never matched. This is a defect
  // in the original test, not in the API. The corrected check lives in
  // test/features/portal.test.ts ("team members are returned by full name").
  // Remove this it.fails when the original /tests scripts are retired (proposed task M0.7).
  it.fails('[original check, fails] Team names include exactly "Yuvika", "Kumkum" and "Aaneya"', async () => {
    const res = await request(app).get('/api/team');
    const names: string[] = res.body.data.map((m: { name: string }) => m.name);
    expect(names.includes('Yuvika') && names.includes('Kumkum') && names.includes('Aaneya')).toBe(true);
  });

  it('Roadmap Milestones Ingestion (GET /api/roadmap): at least 10 phases', async () => {
    const res = await request(app).get('/api/roadmap');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(10);
  });

  // P1 (audit C1): this divergence came from the removed deadline-risk model (carbon sigma used
  // as time). With runtime-only risk the default inputs give the same decision in both
  // scenarios; the corrected demonstration is tested in test/scheduling/engine.test.ts.
  // Remove this it.fails when the original /tests scripts are retired (proposed task M0.7).
  it.fails('[original check, fails] Feasibility Decision Simulation (POST /api/scheduler/simulate): scenarios A and B differ', async () => {
    const res = await request(app)
      .post('/api/scheduler/simulate')
      .send({ durationHours: 2, deadlineHours: 12, riskTolerance: 0.1 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const { scenarioA, scenarioB } = res.body.data.scenarios;
    expect(scenarioA.selectedStartHour).not.toBe(scenarioB.selectedStartHour);
  });

  it('Unauthorized Upload Rejected (POST /api/presentations/upload without token -> 401)', async () => {
    const res = await request(app).post('/api/presentations/upload');
    expect(res.status).toBe(401);
  });

  it('Admin Authentication (POST /api/auth/login) returns a token', async () => {
    const res = await request(app).post('/api/auth/login').send(testAdminCredentials());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.token).toBeTruthy();
  });
});

describe('[legacy] tests/version_upload_test.js', () => {
  let token: string;

  beforeAll(async () => {
    token = await loginAsTestAdmin(app);
  });

  // ORIGINAL ASSERTION, KNOWN TO FAIL: the script uploaded tag "v2" and expected
  // success, then expected v1 and v2 to be retrievable. Tag "v2" is already seeded
  // (as a draft), so the duplicate-tag guard returns 409 and the upload fails.
  // The intended behaviour (duplicate tags rejected; a new version is added while
  // v1 is preserved) is tested in test/features/portal.test.ts.
  // Remove this it.fails when the original /tests scripts are retired (proposed task M0.7).
  it.fails('[original check, fails] uploading version "v2" succeeds and v1 and v2 are both retrievable', async () => {
    const upload = await request(app)
      .post('/api/presentations/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('%PDF-1.4\n% Planning Presentation V2 with Midterm Calibration Spec\n%%EOF'), 'Planning_Presentation_V2.pdf')
      .field('title', 'Planning Presentation V2 - Algorithm Specification')
      .field('versionTag', 'v2')
      .field('presentationDate', '2026-08-25')
      .field('changeSummary', 'Added empirical risk calibration formulation and simulator test harness.')
      .field('isPublished', 'true');
    expect(upload.body.success).toBe(true);

    const v1 = await request(app).get('/api/presentations/v/v1');
    expect(v1.body.success && v1.body.data.versionTag === 'v1').toBe(true);
    const v2 = await request(app).get('/api/presentations/v/v2');
    expect(v2.body.success && v2.body.data.versionTag === 'v2').toBe(true);
  });
});
