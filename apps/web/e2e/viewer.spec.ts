import { expect, test } from '@playwright/test'

test('loads a nonblank Cesium viewer with pipe network controls', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-testid="cesium-container"]')).toBeVisible()
  await expect(page.locator('[data-testid="layer-tree"]')).toBeVisible()

  const canvas = page.locator('canvas').first()
  await expect(canvas).toBeVisible()

  const box = await canvas.boundingBox()
  expect(box?.width).toBeGreaterThan(300)
  expect(box?.height).toBeGreaterThan(300)

  const screenshot = await canvas.screenshot()
  expect(screenshot.length).toBeGreaterThan(10_000)
})
