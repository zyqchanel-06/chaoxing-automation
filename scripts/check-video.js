/**
 * 检查当前内容页的视频任务点状态
 *
 * 用法：playwright-cli -s=<会话> --raw run-code --filename "<skill>/scripts/check-video.js"
 *
 * 返回 JSON（★ pending/finished 是布尔值，方便编排脚本用英文判断，
 * 避开 Windows PowerShell 5.1 读中文脚本的编码坑）：
 *   { hasCards, hasVideoModule, pending: true,  label }  → 需要播放
 *   { hasCards, hasVideoModule, finished: true, label }  → 已完成，跳过
 *   { hasCards: true, kind: 'none' }                     → 该任务点不是视频
 */
async (page) => {
  const mod = page.frames().find((f) => f.url().includes('ananas/modules/video'));
  const cards = page.frames().find((f) => f.url().includes('knowledge/cards'));
  if (!cards) {
    return JSON.stringify({ hasCards: false, hasVideoModule: !!mod, frames: page.frames().map((f) => f.url().slice(0, 70)) });
  }
  const st = await cards.evaluate(() => {
    const ic = document.querySelector('[class*=ans-job-icon]');
    if (!ic) return { kind: 'none', label: null };
    const label = ic.getAttribute('aria-label');
    return {
      kind: (ic.className || '').toString().trim(),
      label,
      pending: label === '任务点未完成',
      finished: label === '任务点已完成',
    };
  });
  return JSON.stringify({ hasCards: true, hasVideoModule: !!mod, ...st });
}
