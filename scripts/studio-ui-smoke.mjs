import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

// Isolated browser storage and intercepted API responses: no paid model calls.
const root = fileURLToPath(new URL('../', import.meta.url))
const artifacts = path.join(root, '.git/codex-ui-qa')
const url = process.env.AIPIC_UI_URL || 'http://127.0.0.1:5194'
const localServer = process.env.AIPIC_UI_URL
  ? null
  : spawn(
      process.execPath,
      [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5194', '--strictPort'],
      { cwd: root, env: { ...process.env, VITE_TASK_BACKEND: 'flyreq' }, stdio: ['ignore', 'pipe', 'pipe'] },
    )
let serverOutput = ''
localServer?.stdout.on('data', (chunk) => {
  serverOutput += chunk
})
localServer?.stderr.on('data', (chunk) => {
  serverOutput += chunk
})
let browser
const errors = []
const checks = []
const check = (label, value) => {
  assert.ok(value, label)
  checks.push(label)
}

try {
  await mkdir(artifacts, { recursive: true })
  let ready = false
  for (let attempt = 0; attempt < 60; attempt++) {
    if (localServer?.exitCode != null) throw new Error(serverOutput)
    try {
      ready = (await fetch(url)).ok
    } catch {
      /* server is starting */
    }
    if (ready) break
    await delay(200)
  }
  assert.ok(ready, `Preview did not start: ${serverOutput}`)
  browser = await chromium.launch({ headless: true, executablePath: chromium.executablePath() })
  const fixture = (await readFile(path.join(root, 'public/studio/product-still-life.jpg'))).toString('base64')
  const requests = []
  const preparePage = async (options) => {
    // Production's worker forwards GET requests outside page.route. Block it in
    // this isolated test context so task polling uses the fixture response too.
    const context = await browser.newContext({ deviceScaleFactor: 1, colorScheme: 'light', serviceWorkers: 'block', ...options })
    const page = await context.newPage()
    page.setDefaultTimeout(8000)
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/*', async (route) => {
      const request = route.request()
      const requestUrl = new URL(request.url())
      if (requestUrl.pathname.startsWith('/api/flyreq/tasks')) {
        if (request.method() === 'POST') {
          requests.push(request.postDataJSON())
          await route.fulfill({ status: 202, json: { taskId: `studio-ui-${requests.length}` } })
        } else {
          await route.fulfill({
            json: { status: 'completed', result: { images: [`data:image/jpeg;base64,${fixture}`] } },
          })
        }
      } else if (requestUrl.origin === new URL(url).origin || requestUrl.protocol === 'data:') {
        await route.continue()
      } else {
        await route.abort()
      }
    })
    await page.goto(url)
    await page.locator('.studio-app').waitFor()
    await page.getByRole('button', { name: '跳过新手引导', exact: true }).click()
    return page
  }
  const workspaceGeometry = (page) => page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector)
      return element ? (() => {
        const { x, y, width, height } = element.getBoundingClientRect()
        return { x, y, width, height }
      })() : null
    }
    return {
      bodyTop: document.body.scrollTop,
      bodyHeight: document.body.scrollHeight,
      documentTop: document.documentElement.scrollTop,
      documentHeight: document.documentElement.scrollHeight,
      main: rect('.studio-main'),
      sheet: rect('.studio-sheet'),
      sheetScrollTop: document.querySelector('.studio-sheet-body')?.scrollTop ?? null,
      settings: rect('.apple-settings'),
      settingsScrollTop: document.querySelector('.apple-settings-scroll')?.scrollTop ?? null,
    }
  })
  const settlePageAnimations = (page) => page.evaluate(async () => {
    await Promise.all(document.getAnimations()
      // ScrollTimeline fades do not finish until the user scrolls to the end.
      .filter((animation) => animation.timeline instanceof DocumentTimeline && animation.playState === 'running' && animation.effect?.getComputedTiming().iterations !== Infinity)
      .map((animation) => animation.finished.catch(() => undefined)))
  })
  const sameGeometry = (before, after) => JSON.stringify(before) === JSON.stringify(after)
  const verifyFlatTabs = async (page, label) => {
    await settlePageAnimations(page)
    const failures = await page.locator('.studio-tabs').evaluateAll((groups) => groups.flatMap((group) => {
      const bounds = group.getBoundingClientRect()
      if (!bounds.width || !bounds.height) return []
      const issues = []
      const list = group.querySelector('[role="tablist"]')
      for (const element of [group, ...group.querySelectorAll('*')]) {
        const rect = element.getBoundingClientRect()
        if (!rect.width || !rect.height) continue
        const style = getComputedStyle(element)
        if (style.boxShadow !== 'none' || style.filter !== 'none') issues.push(`${element.tagName}: shadow or filter`)
        if (rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1) issues.push(`${element.tagName}: paint outside tab bounds`)
      }
      if (getComputedStyle(group).backgroundColor !== 'rgba(0, 0, 0, 0)' || !list || getComputedStyle(list).backgroundColor !== 'rgba(0, 0, 0, 0)') {
        issues.push('Raised or recessed background remains')
      }
      return issues
    }))
    assert.deepEqual(failures, [], label)
    checks.push(label)
  }
  const verifyPhotoCards = async (page, label) => {
    await page.waitForFunction(() => [...document.querySelectorAll('.studio-template img')].filter((image) => {
      const r = image.getBoundingClientRect()
      return r.width > 0 && r.top < innerHeight && r.bottom > 0
    }).every((image) => image.complete && image.naturalWidth > 0))
    const cards = await page.locator('.studio-template').evaluateAll((elements) => elements.map((card) => {
      const image = card.querySelector('.studio-artwork > img')
      const rect = card.getBoundingClientRect()
      const photo = image?.getBoundingClientRect()
      const info = card.querySelector('.studio-template-info')
      return {
        title: card.querySelector('h2')?.textContent,
        photograph: image?.src && new URL(image.src).pathname.includes('/studio/'),
        coversCard: photo && Math.abs(photo.width - rect.width) < 1 && Math.abs(photo.height - rect.height) < 1,
        integratedCaption: info && getComputedStyle(info).backgroundColor === 'rgba(0, 0, 0, 0)',
        controlsFit: info && info.scrollWidth <= info.clientWidth,
      }
    }))
    check(`${label}: every preset has a full photograph and integrated caption`, cards.length > 0 && cards.every((card) => card.photograph && card.coversCard && card.integratedCaption && card.controlsFit))
  }
  const verifyEditorContrast = async (page, theme) => {
    await page.waitForFunction((mode) => document.documentElement.dataset.mode === mode, theme)
    await settlePageAnimations(page)
    const result = await page.locator('.studio-prompt-editor').evaluate((editor) => {
      const style = getComputedStyle(editor)
      const luminance = (color) => {
        const rgb = color.match(/[\d.]+/g).slice(0, 3).map(Number).map((n) => n / 255).map((n) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
      }
      const a = luminance(style.webkitTextFillColor || style.color), b = luminance(style.backgroundColor)
      return { ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), caretVisible: style.caretColor !== style.backgroundColor }
    })
    check(`Assistant editor has readable text and caret in ${theme} mode`, result.ratio >= 4.5 && result.caretVisible)
  }
  const verifyStableMenu = async (page, trigger, label) => {
    await trigger.scrollIntoViewIfNeeded()
    await settlePageAnimations(page)
    const before = await workspaceGeometry(page)
    await trigger.click()
    const listbox = page.getByRole('listbox')
    await listbox.waitFor()
    await settlePageAnimations(page)
    assert.deepEqual(await workspaceGeometry(page), before, `${label}: opening must preserve layout and scroll`)
    checks.push(`${label}: opening preserves layout and scroll`)
    const menu = await listbox.boundingBox()
    const viewport = page.viewportSize()
    check(`${label}: menu stays inside the viewport`, menu && menu.y >= 0 && menu.x >= 0 && menu.y + menu.height <= viewport.height && menu.x + menu.width <= viewport.width)
    await page.keyboard.press('Escape')
    await listbox.waitFor({ state: 'hidden' })
    await settlePageAnimations(page)
    assert.deepEqual(await workspaceGeometry(page), before, `${label}: closing must preserve layout and scroll`)
    checks.push(`${label}: closing preserves layout and scroll`)
    check(`${label}: closing restores focus to the selector`, await trigger.evaluate((element) => element === document.activeElement))
  }
  const connect = async (page) => {
    await page.locator('.studio-generate').click()
    await page.getByRole('dialog', { name: '设置', exact: true }).waitFor()
    await page.getByRole('dialog', { name: '设置', exact: true }).evaluate(async (element) => {
      await Promise.allSettled(element.getAnimations().map((animation) => animation.finished))
    })
    await page.screenshot({ path: path.join(artifacts, `${page.viewportSize().width < 721 ? 'mobile' : 'desktop'}-api-settings.png`), scale: 'css' })
    check(
      'Advanced API settings are collapsed initially',
      (await page.getByRole('button', { name: /^高级参数/ }).getAttribute('aria-expanded')) === 'false',
    )
    await page.getByRole('textbox', { name: 'API 地址', exact: true }).fill('https://aipic-ui-test.invalid/v1')
    await page.getByRole('textbox', { name: 'API 密钥', exact: true }).fill('local-ui-test')
    await page.getByRole('button', { name: '关闭', exact: true }).click()
  }
  const page = await preparePage({ viewport: { width: 1440, height: 960 } })
  await verifyFlatTabs(page, 'Desktop tabs have no shadows, recessed backgrounds, or displaced paint')
  await page.locator('.studio-prompt textarea').focus()
  await page.keyboard.press('Shift+Tab')
  check('Generation tabs retain a visible keyboard focus indicator', await page.getByRole('tab', { name: '文生图', exact: true }).evaluate((tab) => {
    const style = getComputedStyle(tab)
    return tab === document.activeElement && tab.matches(':focus-visible') && parseFloat(style.outlineWidth) >= 2
  }))
  await page.getByRole('tab', { name: '文生图', exact: true }).click()
  check('AI Native has no NEW marker', (await page.getByRole('button', { name: 'AI Native', exact: true }).getByText('NEW', { exact: true }).count()) === 0)
  check('Combined commerce entry is first and marked NEW', (await page.locator('.studio-sidebar nav[aria-label="创作工具"] button').first().innerText()).includes('电商 · 小红书') && (await page.locator('.studio-sidebar .studio-nav-new').innerText()) === 'NEW')
  await page.screenshot({ path: path.join(artifacts, 'desktop-workspace.png'), scale: 'css' })
  await page.getByRole('button', { name: '电商 · 小红书', exact: true }).click()
  check('Commerce and Xiaohongshu share one library', (await page.locator('.studio-template').count()) === 4)
  await page.getByRole('group', { name: '模板分组' }).getByRole('button', { name: '电商商品图', exact: true }).click()
  check('Browsing templates uses the full content area', !(await page.locator('.studio-composer').isVisible()))
  await verifyPhotoCards(page, 'Ecommerce library')
  check('Ecommerce has two ready-to-use examples', (await page.locator('.studio-example-button').count()) === 2)
  await page.getByRole('button', { name: '选择纯净商品主图', exact: true }).click()
  await page.locator('.studio-workflow-line').getByRole('button', { name: '更换模板', exact: true }).click()
  await page.getByRole('button', { name: '选择生活场景广告', exact: true }).click()
  check(
    'Creative layouts remain mutually exclusive',
    (await page.locator('.studio-selected-templates button').count()) === 1,
  )
  await page.locator('.studio-workflow-line').getByRole('button', { name: '更换模板', exact: true }).click()
  await page.getByLabel('搜索模板').fill('no-template-matches-this')
  check(
    'Empty search has a recovery action',
    await page.getByRole('button', { name: '查看全部', exact: true }).isVisible(),
  )
  await page.getByRole('button', { name: '查看全部', exact: true }).click()
  await page.locator('.studio-example-button').first().click()
  check(
    'Example fills a complete product prompt',
    (await page.locator('.studio-prompt textarea').inputValue()).includes('晴屿'),
  )
  check(
    'Text-only example selects text-to-image mode',
    (await page.getByRole('tab', { name: '文生图', exact: true }).getAttribute('aria-selected')) === 'true',
  )
  await page.getByRole('button', { name: '打开输出设置' }).click()
  await page.getByRole('dialog', { name: '输出设置', exact: true }).waitFor()
  await settlePageAnimations(page)
  check('Background shows its label before the first menu open', (await page.getByRole('combobox', { name: '背景', exact: true }).innerText()) === '服务商默认')
  const backgroundBefore = await workspaceGeometry(page)
  await page.getByRole('combobox', { name: '背景', exact: true }).click()
  await page.getByRole('listbox').waitFor()
  check(
    'Opening output background does not move the workspace',
    sameGeometry(backgroundBefore, await workspaceGeometry(page)),
  )
  await page.keyboard.press('Escape')
  check(
    'Closing output background does not move the workspace',
    sameGeometry(backgroundBefore, await workspaceGeometry(page)),
  )
  check('Streaming defaults to off', (await page.getByRole('switch').getAttribute('aria-checked')) === 'false')
  await page.getByRole('switch').click()
  await page.getByRole('switch').click()
  await page.getByRole('combobox', { name: '文件格式', exact: true }).click()
  await page.getByRole('option', { name: 'GIF · 动图', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'GIF 帧数' }).fill('12')
  await page.getByRole('spinbutton', { name: '每帧时长（ms）' }).fill('250')
  await page.getByRole('button', { name: '完成', exact: true }).click()
  check(
    'GIF summary reflects edited frame count',
    (await page.locator('.studio-output-settings').innerText()).includes('12 帧'),
  )
  await page.getByRole('button', { name: '打开输出设置' }).click()
  check(
    'GIF frame duration survives closing the sheet',
    (await page.getByRole('spinbutton', { name: '每帧时长（ms）' }).inputValue()) === '250',
  )
  await page.getByRole('combobox', { name: '文件格式', exact: true }).click()
  await page.getByRole('option', { name: 'PNG', exact: true }).click()
  await page.getByRole('button', { name: /比例与自定义尺寸/ }).click()
  const sizeDialog = page.getByRole('dialog', { name: '设置图像尺寸', exact: true })
  await sizeDialog.getByRole('tab', { name: '自定义宽高', exact: true }).click()
  await sizeDialog.getByLabel('宽度 (Width)').fill('1536')
  await sizeDialog.getByLabel('高度 (Height)').fill('1024')
  await sizeDialog.getByRole('button', { name: '确定', exact: true }).click()
  check('Size dialog applies the custom resolution', (await page.getByRole('button', { name: /比例与自定义尺寸/ }).innerText()).includes('1536 × 1024'))
  await page.getByRole('button', { name: /比例与自定义尺寸/ }).click()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('dialog', { name: '输出设置', exact: true }).waitFor()
  check('Size picker returns to the settings sheet', (await page.getByRole('dialog').count()) === 1)
  await page.keyboard.press('Escape')
  await settlePageAnimations(page)
  check(
    'Escape restores keyboard focus to the trigger',
    (await page.locator(':focus').getAttribute('aria-label')) === '打开输出设置',
  )
  await connect(page)
  await page.locator('.studio-generate').click()
  await page.locator('.retouch-preview-image').first().waitFor()
  await page.getByRole('button', { name: '全屏预览', exact: true }).click()
  await page.locator('[data-lightbox-root]').waitFor()
  check('Full-screen image preview remains available', await page.locator('[data-lightbox-root] .saveable-image').isVisible())
  await page.keyboard.press('Escape')
  await page.locator('[data-lightbox-root]').waitFor({ state: 'hidden' })
  check(
    'Generation submits the example with streaming off',
    requests[0]?.mode === 'text-to-image' &&
      requests[0]?.streamImages === false &&
      requests[0]?.prompt.includes('晴屿'),
  )
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载输出图片' }).click()
  check('Completed result can be downloaded', (await download).suggestedFilename() === 'aipic.jpg')
  await page.getByRole('button', { name: '放大预览', exact: true }).click()
  check('Canvas zoom changes', (await page.locator('.studio-zoom-label').innerText()) === '125%')
  await page.locator('.studio-zoom-label').click()
  await page.getByRole('button', { name: '打开创作历史' }).click()
  check('Generated result appears in history', (await page.locator('.studio-history-item').count()) === 1)
  await page.getByRole('dialog').getByRole('button', { name: '失败', exact: true }).click()
  check('History filters show correct empty state', await page.getByText('暂无这类记录', { exact: true }).isVisible())
  await page.keyboard.press('Escape')
  await page.locator('input[type=file]').first().setInputFiles(path.join(root, 'public/studio/portrait-light.jpg'))
  await page.locator('.studio-input-images img').first().waitFor()
  check(
    'Uploading a reference selects edit mode',
    (await page.getByRole('tab', { name: '图生图', exact: true }).getAttribute('aria-selected')) === 'true',
  )
  await page.locator('.studio-prompt textarea').fill('保留参考照片身份和构图，整理光线并保持自然肤色。')
  await page.locator('.studio-generate').click()
  for (let i = 0; i < 40 && !(await page.getByRole('button', { name: '对比', exact: true }).isEnabled()); i++)
    await delay(100)
  check(
    'Edit generation carries the reference image',
    requests[1]?.mode === 'image-to-image' && requests[1]?.images.length === 1,
  )
  await page.getByRole('button', { name: '对比', exact: true }).click()
  check(
    'Before/after comparison remains available',
    await page.getByRole('slider', { name: '原图与结果对比位置' }).isVisible(),
  )
  await page.getByRole('slider', { name: '原图与结果对比位置' }).press('ArrowRight')
  await page.getByRole('button', { name: '对比', exact: true }).click()
  await page.getByRole('button', { name: 'AI Native', exact: true }).click()
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.screenshot({ path: path.join(artifacts, 'desktop-dark.png'), scale: 'css' })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.getByRole('button', { name: '打开 API 设置', exact: true }).click()
  const settingsDialog = page.getByRole('dialog', { name: '设置', exact: true })
  await settingsDialog.getByRole('combobox', { name: '修图/生图：Images API', exact: true }).click()
  await page.getByRole('option', { name: '助手对话：Responses API', exact: true }).click()
  await settingsDialog.getByRole('button', { name: /^高级参数/ }).click()
  const reasoningEffort = settingsDialog.getByRole('combobox', { name: '推理强度', exact: true })
  await reasoningEffort.scrollIntoViewIfNeeded()
  const reasoningBefore = await workspaceGeometry(page)
  await reasoningEffort.click()
  await page.getByRole('listbox').waitFor()
  check(
    'Opening reasoning effort does not move the workspace or settings scroll',
    sameGeometry(reasoningBefore, await workspaceGeometry(page)),
  )
  await page.getByRole('option', { name: 'high', exact: true }).click()
  check('Reasoning effort selection is applied', (await reasoningEffort.innerText()) === 'high')

  const settingsBackground = settingsDialog.getByRole('combobox', { name: '背景', exact: true })
  await settingsBackground.scrollIntoViewIfNeeded()
  const settingsBackgroundBefore = await workspaceGeometry(page)
  await settingsBackground.click()
  await page.getByRole('listbox').waitFor()
  check(
    'Opening settings background does not move the workspace or settings scroll',
    sameGeometry(settingsBackgroundBefore, await workspaceGeometry(page)),
  )
  await page.keyboard.press('Escape')
  check(
    'Closing settings background does not move the workspace or settings scroll',
    sameGeometry(settingsBackgroundBefore, await workspaceGeometry(page)),
  )
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click()
  await page.getByRole('button', { name: '对话历史' }).waitFor()
  await page.locator('.studio-prompt-editor').fill('文字现在清晰可读，适合连续编辑。')
  await verifyEditorContrast(page, 'light')
  await page.getByRole('status').waitFor({ state: 'hidden' })
  await page.screenshot({ path: path.join(artifacts, 'desktop-assistant.png'), scale: 'css' })
  await page.locator('.studio-agent-input').screenshot({ path: path.join(artifacts, 'assistant-input-light.png'), scale: 'css' })
  await page.emulateMedia({ colorScheme: 'dark' })
  await verifyEditorContrast(page, 'dark')
  await page.screenshot({ path: path.join(artifacts, 'desktop-assistant-dark.png'), scale: 'css' })
  await page.locator('.studio-agent-input').screenshot({ path: path.join(artifacts, 'assistant-input-dark.png'), scale: 'css' })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.waitForFunction(() => document.documentElement.dataset.mode === 'light')
  await page.locator('.studio-prompt-editor').fill('')
  check(
    'Responses configuration opens the assistant workspace',
    await page.getByRole('button', { name: '返回修图工作台' }).isVisible(),
  )
  await page.getByRole('button', { name: '返回修图工作台' }).click()
  check(
    'Assistant navigation returns to the studio',
    await page.locator('.studio-app').isVisible(),
  )
  await page.locator('.studio-retouch-nav summary').click()
  await page.getByRole('navigation', { name: '精修工具' }).getByRole('button', { name: /^人像/ }).click()
  await page.getByRole('group', { name: '模板分组' }).getByRole('button', { name: '瘦身', exact: true }).click()
  await page.getByRole('button', { name: '选择瘦腰', exact: true }).click()
  check('Grouped retouch presets keep their parent navigation active', await page.getByRole('navigation', { name: '精修工具' }).getByRole('button', { name: /^人像/ }).getAttribute('aria-current') === 'page')

  const mobile = await preparePage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await verifyFlatTabs(mobile, 'Mobile top and bottom tabs have no shadows or displaced backgrounds')
  await mobile.getByRole('button', { name: '打开导航' }).click()
  await mobile.getByRole('dialog').getByRole('button', { name: 'AI 助手', exact: true }).click()
  await mobile.getByRole('alertdialog', { name: '需要 Responses API 配置', exact: true }).waitFor()
  await mobile.getByRole('dialog', { name: '创作导航', exact: true }).waitFor({ state: 'hidden' })
  check('Assistant configuration prompt is accessible outside mobile navigation', !(await mobile.getByRole('dialog', { name: '创作导航', exact: true }).isVisible()))
  await mobile.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).click()
  await mobile.getByRole('button', { name: '打开导航' }).click()
  await mobile.getByRole('dialog').getByRole('button', { name: '电商 · 小红书', exact: true }).click()
  await mobile.getByRole('group', { name: '模板分组' }).getByRole('button', { name: '小红书推广', exact: true }).click()
  await verifyPhotoCards(mobile, 'Mobile Xiaohongshu library')
  check('Mobile navigation opens Xiaohongshu templates', (await mobile.locator('.studio-example-button').count()) === 2)
  await mobile.screenshot({ path: path.join(artifacts, 'mobile-xiaohongshu.png'), scale: 'css' })
  await mobile.locator('.studio-example-button').first().click()
  check(
    'Xiaohongshu example fills exact campaign copy',
    (await mobile.locator('.studio-prompt textarea').inputValue()).includes('把春天写进日常'),
  )
  await mobile.getByRole('button', { name: '打开输出设置' }).click()
  await mobile.getByRole('dialog', { name: '输出设置', exact: true }).waitFor()
  await verifyStableMenu(mobile, mobile.getByRole('combobox', { name: '背景', exact: true }), 'Mobile output background')
  await mobile.getByRole('combobox', { name: '文件格式', exact: true }).click()
  await mobile.getByRole('option', { name: 'GIF · 动图', exact: true }).click()
  await mobile.getByRole('status').waitFor({ state: 'hidden' })
  await mobile.screenshot({ path: path.join(artifacts, 'mobile-output-sheet.png'), scale: 'css' })
  await mobile.getByRole('combobox', { name: '文件格式', exact: true }).click()
  await mobile.getByRole('option', { name: 'PNG', exact: true }).click()
  await mobile.getByRole('button', { name: '完成', exact: true }).click()
  await connect(mobile)
  await mobile.locator('.studio-generate').click()
  await mobile.locator('.retouch-preview-image').first().waitFor()
  check('Mobile example reaches a generated result', requests.length === 3 && requests[2]?.prompt.includes('青芽纸间'))
  await mobile.getByRole('button', { name: '打开 API 设置', exact: true }).click()
  const mobileSettings = mobile.getByRole('dialog', { name: '设置', exact: true })
  await mobileSettings.getByRole('combobox', { name: '修图/生图：Images API', exact: true }).click()
  await mobile.getByRole('option', { name: '助手对话：Responses API', exact: true }).click()
  await mobileSettings.getByRole('button', { name: /^高级参数/ }).click()
  await verifyStableMenu(mobile, mobileSettings.getByRole('combobox', { name: '推理强度', exact: true }), 'Mobile reasoning effort')
  await verifyStableMenu(mobile, mobileSettings.getByRole('combobox', { name: '背景', exact: true }), 'Mobile settings background')
  await mobileSettings.getByRole('button', { name: '关闭', exact: true }).click()
  for (const width of [320, 390, 663, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await verifyFlatTabs(page, `Flat tabs stay within their bounds at ${width}px`)
    check(
      `No horizontal overflow at ${width}px`,
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
  }
  const categoryButtons = page.locator('.studio-sidebar nav[aria-label="精修工具"] button')
  const categories = await categoryButtons.allTextContents()
  for (let index = 0; index < categories.length; index++) {
    if (!(await page.locator('.studio-retouch-nav').evaluate((details) => details.open))) await page.locator('.studio-retouch-nav summary').click()
    await categoryButtons.nth(index).click()
    const groups = page.getByRole('group', { name: '模板分组' }).getByRole('button')
    const labels = await groups.allTextContents()
    if (!labels.length) await verifyPhotoCards(page, categories[index])
    for (let group = 0; group < labels.length; group++) {
      await groups.nth(group).click()
      await verifyPhotoCards(page, `${categories[index]} / ${labels[group]}`)
    }
  }
  await page.getByRole('button', { name: 'AI Native', exact: true }).click()
  const nativeGroups = page.getByRole('group', { name: '模板分组' }).getByRole('button')
  const nativeLabels = await nativeGroups.allTextContents()
  for (let index = 0; index < nativeLabels.length; index++) {
    await nativeGroups.nth(index).click()
    await verifyPhotoCards(page, `AI Native / ${nativeLabels[index]}`)
  }
  await nativeGroups.first().click()
  await verifyPhotoCards(page, 'AI Native library')
  await page.screenshot({ path: path.join(artifacts, 'desktop-library.png'), scale: 'css' })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForFunction(() => document.documentElement.dataset.mode === 'dark')
  await settlePageAnimations(page)
  await verifyPhotoCards(page, 'Dark library')
  await page.screenshot({ path: path.join(artifacts, 'desktop-library-dark.png'), scale: 'css' })
  const personal = await preparePage({ viewport: { width: 1280, height: 900 } })
  await personal.getByRole('button', { name: '我的模板', exact: true }).click()
  await personal.getByRole('button', { name: '新建模板', exact: true }).click()
  await personal.getByRole('textbox', { name: '模板名称', exact: true }).fill('我的商品摄影')
  await personal.getByRole('textbox', { name: '模板介绍', exact: true }).fill('自然光，保留真实包装')
  await personal.getByRole('textbox', { name: '模板提示词', exact: true }).fill('一只玻璃杯放在窗边，保留真实纹理。')
  await settlePageAnimations(personal)
  await personal.screenshot({ path: path.join(artifacts, 'personal-template-editor.png'), scale: 'css' })
  await personal.getByRole('button', { name: '保存模板', exact: true }).click()
  check('A personal template appears after saving', await personal.getByRole('heading', { name: '我的商品摄影', exact: true }).isVisible())
  await personal.setViewportSize({ width: 390, height: 844 })
  await verifyPhotoCards(personal, 'Mobile personal templates')
  await personal.getByRole('button', { name: '编辑模板：我的商品摄影', exact: true }).click()
  await settlePageAnimations(personal)
  check('Personal template editor fits a mobile viewport', await personal.getByRole('button', { name: '保存模板', exact: true }).isVisible() && await personal.locator('.studio-template-form').evaluate((form) => form.scrollWidth <= form.clientWidth))
  await personal.getByRole('button', { name: '取消', exact: true }).click()
  await personal.setViewportSize({ width: 1280, height: 900 })
  await personal.reload()
  await personal.getByRole('button', { name: '我的模板', exact: true }).click()
  check('Personal templates survive a page reload', await personal.getByRole('heading', { name: '我的商品摄影', exact: true }).isVisible())
  await personal.getByRole('button', { name: '编辑模板：我的商品摄影', exact: true }).click()
  const personalPrompt = '保留杯身文字和形状，使用柔和窗光与真实接触阴影。'
  await personal.getByRole('textbox', { name: '模板提示词', exact: true }).fill(personalPrompt)
  await personal.getByRole('button', { name: '保存模板', exact: true }).click()
  check('Editing updates the existing template', (await personal.locator('.studio-template').count()) === 1)
  await verifyPhotoCards(personal, 'Personal template library')
  await personal.getByRole('button', { name: '使用模板', exact: true }).click()
  check('Using a personal template restores its exact prompt and mode', (await personal.locator('.studio-prompt textarea').inputValue()) === personalPrompt && (await personal.getByRole('tab', { name: '文生图', exact: true }).getAttribute('aria-selected')) === 'true')
  await personal.getByRole('button', { name: '打开输出设置', exact: true }).click()
  await personal.getByRole('combobox', { name: '文件格式', exact: true }).click()
  await personal.getByRole('option', { name: 'WebP', exact: true }).click()
  await personal.getByRole('button', { name: '完成', exact: true }).click()
  await personal.getByRole('button', { name: '我的模板', exact: true }).click()
  await personal.getByRole('button', { name: '使用模板', exact: true }).click()
  check('Using a personal template restores its saved output format', (await personal.locator('.studio-output-settings').innerText()).includes('PNG'))
  await personal.getByRole('button', { name: '我的模板', exact: true }).click()
  await personal.getByRole('button', { name: '删除模板：我的商品摄影', exact: true }).click()
  await personal.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).click()
  check('Cancelling deletion keeps the personal template', (await personal.locator('.studio-template').count()) === 1)
  await personal.getByRole('button', { name: '删除模板：我的商品摄影', exact: true }).click()
  await personal.getByRole('alertdialog').getByRole('button', { name: '删除模板', exact: true }).click()
  await personal.reload()
  await personal.getByRole('button', { name: '我的模板', exact: true }).click()
  check('Confirmed personal template deletion persists', (await personal.locator('.studio-template').count()) === 0)
  check('No browser runtime errors', errors.length === 0)
  const report = { passed: checks.length, checks, pageErrors: errors, liveModelRequests: 0 }
  await writeFile(path.join(artifacts, 'smoke-report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser?.close()
  if (localServer && localServer.exitCode == null) localServer.kill('SIGTERM')
}
