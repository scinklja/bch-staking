// Playwright's bundled headless shell avoids desktop Chromium and its extensions.
// Install with: npx playwright install --with-deps chromium --only-shell
export const launchOptions = {
  headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--disable-gpu'],
};
