// @ts-check
import { test, expect } from '@playwright/test';

// Checks that support linking the live demo from the NLarchive portfolio:
// brand attribution, SEO metadata, CSP cleanliness and the clickjacking guard.

test.describe('Portfolio integration — live demo page', () => {
  test('footer links to the source code and to NLarchive', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#btn-create')).toBeVisible();
    const brand = page.locator('#brand-link');
    await expect(brand).toHaveText('Built by NLarchive');
    await expect(brand).toHaveAttribute('href', 'https://www.nlarchive.com/proyectos/');
    await expect(page.locator('.app-footer a[href="https://github.com/NLarchive/web-p2p-message"]')).toBeVisible();
  });

  test('head exposes description, canonical, Open Graph and JSON-LD', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/P2P Message/);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /encrypted/i);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://nlarchive.github.io/web-p2p-message/');
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /og-image\.png$/);
    const ld = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent() || '{}');
    expect(ld['@type']).toBe('SoftwareApplication');
    expect(ld.publisher.name).toBe('NLarchive SpA');
    const og = await page.request.get('src/ui/og-image.png');
    expect(og.status()).toBe(200);
  });

  test('page loads without Content Security Policy violations', async ({ page }) => {
    const violations = [];
    page.on('console', (msg) => {
      if (/Content Security Policy|Refused to/i.test(msg.text())) violations.push(msg.text());
    });
    await page.goto('/');
    await expect(page.locator('#btn-create')).toBeVisible();
    await page.waitForTimeout(500);
    expect(violations).toEqual([]);
  });

  test('app refuses to run inside a frame (clickjacking guard)', async ({ page, baseURL }) => {
    await page.setContent(`<iframe id="victim" src="${baseURL}/" width="800" height="600"></iframe>`);
    const frame = page.frameLocator('#victim');
    await expect(frame.locator('#framed-warning')).toBeVisible();
    await expect(frame.locator('#btn-create')).toHaveCount(0);
  });
});
