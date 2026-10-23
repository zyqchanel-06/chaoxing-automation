/**
 * 视频任务点保活播放器（学习通）—— 含「视频弹题」检测
 *
 * 用法：playwright-cli -s=<会话> --raw run-code --filename "<skill>/scripts/watch-video.js"
 *
 * 单次调用跑约 MAX_ROUNDS × INTERVAL（默认 ≈ 4 分钟）。返回三种结果：
 *   { done: true, t, dur }            → 已达标（duration × 0.9），可以下一节
 *   { quiz: true, quizId, text, t }   → ★ 视频弹题挡住了，需要答题后才能继续
 *   { t, dur, paused, rate }          → 还在播，外层再调一次
 *
 * ★★ 视频弹题：学习通会在视频播到某些时间点时弹一道题（判断题/选择题），
 *   **并暂停视频**，不答就永远卡住。DOM：
 *     .ans-videoquiz (id=videoquiz-<n>)  容器
 *     li.ans-videoquiz-opt               选项
 *     a#videoquiz-submit                 提交
 *   选择器命中 quiz 时**不要继续等**，立刻返回让上层去答题。
 *
 * ★★ 鼠标必须留在页面内：平台靠「真实鼠标在不在页面上」判断用户是否离开，
 *   鼠标一走视频就暂停（而且毫无提示）。必须用 page.mouse.move()（真实 CDP 事件），
 *   dispatchEvent 派发的假事件无效（实测 0.77x vs 1.98x）。
 *
 * ★ 倍速上限 2x：设 4x 会被平台立即重置回 2。
 */
async (page) => {
  const RATIO = 0.9;         // 完成门槛：见 .task-condition
  const RATE = 2;            // 平台允许的上限
  const INTERVAL = 2500;
  const MAX_ROUNDS = 96;     // ≈ 4 分钟/次

  const mod = page.frames().find((f) => f.url().includes('ananas/modules/video'));
  if (!mod) {
    return JSON.stringify({ err: 'NO_VIDEO_MODULE', frames: page.frames().map((f) => f.url().slice(0, 80)) });
  }

  const box = await page.mainFrame().evaluate(() => ({ w: innerWidth, h: innerHeight }));
  const t0 = Date.now();
  let startT = null, pauses = 0, last = null;

  for (let i = 0; i < MAX_ROUNDS; i++) {
    await page.mouse.move(
      Math.round(box.w * 0.5) + (i % 7) * 4,
      Math.round(box.h * 0.5) + (i % 5) * 4,
    );

    last = await mod.evaluate(async (args) => {
      const v = document.querySelector('video');
      if (!v) return { err: 'no video element' };

      // ★ 检测弹题面板
      const q = document.querySelector('.ans-videoquiz');
      if (q && (q.offsetWidth || q.offsetHeight)) {
        if (v.paused) {
          // ★★ 弹题出现时平台会**暂停视频** —— 所以「面板可见 + 视频暂停」= 真·待答。
          //    立刻返回让上层去答题，别在这儿耗时间。
          return {
            quiz: true,
            quizId: q.id || '',
            text: (q.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 400),
            opts: [...q.querySelectorAll('.ans-videoquiz-opt')].map((li) => (li.innerText || '').trim().slice(0, 60)),
            t: Math.round(v.currentTime),
            dur: Math.round(v.duration || 0),
          };
        }
        // ★★ 「面板可见 + 视频在播」= 残留面板（答题后没关干净）。
        //    残留会挡住下一个弹题点，必须清掉；但**别用 v.play() 硬推**（那正是造成残留的原因）。
        const cont = document.getElementById('videoquiz-continue');
        if (cont && (cont.offsetWidth || cont.offsetHeight)) {
          try { cont.click(); } catch (e) {}
        } else {
          try { q.style.display = 'none'; } catch (e) {}
        }
        await new Promise((res) => setTimeout(res, 600));
      }

      const dur = v.duration || 0;
      if (dur > 0 && v.currentTime >= dur * args.ratio) {
        try { v.pause(); } catch (e) {}
        return { done: true, t: Math.round(v.currentTime), dur: Math.round(dur), pct: 100 };
      }

      const wasPaused = v.paused;
      if (v.playbackRate !== args.rate) { try { v.playbackRate = args.rate; } catch (e) {} }
      if (wasPaused) { const pr = v.play(); if (pr && pr.catch) pr.catch(() => {}); }

      return {
        t: Math.round(v.currentTime),
        dur: Math.round(dur),
        pct: dur > 0 ? Math.round((v.currentTime / dur) * 100) : 0,
        wasPaused, rate: v.playbackRate,
      };
    }, { ratio: RATIO, rate: RATE });

    if (last && last.err) break;
    if (i === 0) startT = last.t;
    if (last.wasPaused) pauses++;
    if (last.quiz || last.done) break;
    await page.waitForTimeout(INTERVAL);
  }

  const realSecs = Math.round((Date.now() - t0) / 1000);
  const advanced = (last && startT !== null && !last.quiz) ? last.t - startT : 0;
  return JSON.stringify({
    last, startT, advanced, realSecs,
    effRate: realSecs > 0 ? Math.round((advanced / realSecs) * 100) / 100 : 0,
    pauses,
  });
}
