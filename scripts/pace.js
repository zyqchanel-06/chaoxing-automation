/**
 * 操作节流助手 —— 控制自动化请求的频率
 *
 * 自动化跑得比人快得多，连续密集的提交会给服务端造成不必要的压力。
 * 这里在两次操作之间插入等待，让请求节奏平缓一些。
 *
 * 用法：把 PACE 定义注入到 run-code 开头，在每次「提交」前 await 一次。
 *
 * playwright-cli run-code "async (page) => {
 *   const PACE = {...};                      // 见下方默认值
 *   ...
 *   await throttledPause(page, PACE, {readSeconds: 141});   // 提交前等一段
 *   await submit();
 * }"
 */

const PACE = {
  // 有媒体素材的题：按素材时长比例等待
  audioFactorMin: 0.6,
  audioFactorMax: 1.2,
  // 无媒体素材的题：等待区间（秒）
  thinkMin: 25,
  thinkMax: 70,
  // 额外抖动（秒）
  jitterMin: 5,
  jitterMax: 25,
  // 单个会话最多连续处理几题
  maxPerSession: 3,
};

const rand = (a, b) => a + Math.random() * (b - a);

/**
 * 提交前的等待
 * @param {Page} page
 * @param {object} pace  PACE 配置
 * @param {object} opts  { readSeconds } 本题对应素材时长（秒），无素材传 0
 * @returns {Promise<number>} 实际等待秒数
 */
async function throttledPause(page, pace, opts = {}) {
  const p = { ...PACE, ...pace };
  const media = opts.readSeconds || 0;

  let seconds;
  if (media > 0) {
    seconds = media * rand(p.audioFactorMin, p.audioFactorMax);
  } else {
    seconds = rand(p.thinkMin, p.thinkMax);
  }
  seconds += rand(p.jitterMin, p.jitterMax);

  await page.waitForTimeout(Math.round(seconds * 1000));
  return Math.round(seconds);
}

/**
 * 会话节流：记录本会话已处理几题，超过上限就提示停手
 * 状态放在 window 上，跨 run-code 调用保持
 */
async function paceGuard(page, pace) {
  const p = { ...PACE, ...pace };
  const done = await page.evaluate(() => {
    window.__paceCount = (window.__paceCount || 0) + 1;
    return window.__paceCount;
  });
  return { done, over: done > p.maxPerSession, limit: p.maxPerSession };
}

module.exports = { PACE, throttledPause, paceGuard, rand };