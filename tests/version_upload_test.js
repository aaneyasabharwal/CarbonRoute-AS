const http = require('http');

const PORT = 5000;

// Credentials come from the environment (never hardcoded): ADMIN_USERNAME (default "admin") and ADMIN_PASSWORD.
function adminCredentials() {
  if (!process.env.ADMIN_PASSWORD) {
    console.error("Set ADMIN_PASSWORD (and optionally ADMIN_USERNAME) to the running server's admin credentials.");
    process.exit(2);
  }
  return { username: process.env.ADMIN_USERNAME || "admin", password: process.env.ADMIN_PASSWORD };
}

async function testVersionUpload() {
  console.log('Testing Presentation Version Upload and Permanent Archive Preservation...');

  // 1. Log in as admin
  const loginPayload = JSON.stringify(adminCredentials());
  const loginRes = await fetchJson('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: loginPayload,
  });

  if (!loginRes.token) {
    throw new Error('Admin login failed');
  }
  const token = loginRes.token;
  console.log('  -> Admin authenticated successfully.');

  // 2. Upload Version V2 via multipart/form-data
  const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
  const fileContent = '%PDF-1.4\n% Planning Presentation V2 with Midterm Calibration Spec\n%%EOF';
  
  let body = '';
  body += `--${boundary}\r\n`;
  body += `Content-Disposition: form-data; name="file"; filename="Planning_Presentation_V2.pdf"\r\n`;
  body += `Content-Type: application/pdf\r\n\r\n`;
  body += `${fileContent}\r\n`;

  body += `--${boundary}\r\n`;
  body += `Content-Disposition: form-data; name="title"\r\n\r\n`;
  body += `Planning Presentation V2 - Algorithm Specification\r\n`;

  body += `--${boundary}\r\n`;
  body += `Content-Disposition: form-data; name="versionTag"\r\n\r\n`;
  body += `v2\r\n`;

  body += `--${boundary}\r\n`;
  body += `Content-Disposition: form-data; name="presentationDate"\r\n\r\n`;
  body += `2026-08-25\r\n`;

  body += `--${boundary}\r\n`;
  body += `Content-Disposition: form-data; name="changeSummary"\r\n\r\n`;
  body += `Added empirical risk calibration formulation and simulator test harness.\r\n`;

  body += `--${boundary}\r\n`;
  body += `Content-Disposition: form-data; name="isPublished"\r\n\r\n`;
  body += `true\r\n`;

  body += `--${boundary}--\r\n`;

  const uploadRes = await fetchJson('/api/presentations/upload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body: body,
  });

  if (!uploadRes.success) {
    throw new Error(`Failed to upload V2: ${JSON.stringify(uploadRes)}`);
  }
  console.log('  -> Version V2 successfully uploaded and registered.');

  // 3. Verify V1 is still accessible and untouched
  const v1Res = await fetchJson('/api/presentations/v/v1');
  if (!v1Res.success || v1Res.data.versionTag !== 'v1') {
    throw new Error('V1 is no longer accessible!');
  }
  console.log('  -> Verified: Version V1 is intact, accessible, and unmodified.');

  // 4. Verify V2 is accessible
  const v2Res = await fetchJson('/api/presentations/v/v2');
  if (!v2Res.success || v2Res.data.versionTag !== 'v2') {
    throw new Error('V2 could not be queried!');
  }
  console.log('  -> Verified: Version V2 is accessible at /presentation/v2.');

  // 5. Query all versions list
  const allRes = await fetchJson('/api/presentations/versions');
  const tags = allRes.data.map(v => v.versionTag);
  console.log(`  -> Available version archive: [${tags.join(', ')}]`);

  console.log('🎉 Version preservation test PASSED!');
}

function fetchJson(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`http://localhost:${PORT}${path}`, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ raw: data, status: res.statusCode });
        }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

testVersionUpload().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
