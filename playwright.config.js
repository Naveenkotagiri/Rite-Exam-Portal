import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run the built app (npm run build first) against a separate database.
const E2E_DB = process.env.E2E_DATABASE_URL || 'postgres://exam:exam@localhost:5440/exam_e2e';
const PORT = 3100;

export default defineConfig({
  testDir: 'test/e2e',
  timeout: 90_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    permissions: ['camera'],
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 800 } }, testIgnore: /mobile/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile/ },
  ],
  webServer: {
    command: 'node test/e2e/reset-db.js && node scripts/py.mjs -m app.server',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: E2E_DB,
      PORT: String(PORT),
      JWT_SECRET: 'e2e-secret',
      ADMIN_EMAIL: 'admin@e2e.local',
      ADMIN_PASSWORD: 'Admin@12345',
      ADMIN_NAME: 'E2E Admin',
    },
  },
});
