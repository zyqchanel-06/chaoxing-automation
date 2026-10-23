/**
 * 回答「视频弹题」（学习通）
 *
 * 用法：
 *   playwright-cli -s=<会话> --raw run-code --filename "<skill>/scripts/answer-videoquiz.js" <答案文件>
 *   —— run-code 不方便传参，实际做法：把答案写进工作区 answer.json，再把本文件复制成带答案的临时脚本，
 *      或直接用 answer-videoquiz-tpl.js + 占位替换。
 *
 * 本文件默认读取 ANSWERS 常量（改完再跑）。
 *
 * ★ 视频弹题会**暂停视频**，不答就永远卡住。
 * ★ 弹题**答过就不再出现**（实测：倒回重播也不会再弹）→ 一次必须答对，否则没法重来。
 *   所以答案不可靠时，宁可不答（让上层停下问人），也别瞎猜。
 *
 * 返回：{ ok, picked, submitClicked, label }
 */
async (page) => {
  // ★ 答案：选项下标数组（0 = 第一个选项）。判断题一般 [0]=对 / [1]=错
  const PICKS = [0];
  // ★★ 血的教训：选项结构是 <li><label><span><input type=radio>…
  //    **点 li 不会选中！必须点 label（或直接操作 input）**，且提交前务必回读 radio.checked。
  //    否则会"没选就提交" → 平台一律回「回答错误」，让人误判成答案错了。

  const mod = page.frames().find((f) => f.url().includes('ananas/modules/video'));
  if (!mod) return JSON.stringify({ ok: false, err: 'NO_VIDEO_MODULE' });

  const before = await mod.evaluate(() => {
    const q = document.querySelector('.ans-videoquiz');
    if (!q || !(q.offsetWidth || q.offsetHeight)) return null;
    return {
      id: q.id || '',
      text: (q.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 300),
      opts: [...q.querySelectorAll('.ans-videoquiz-opt')].map((li) => (li.innerText || '').trim().slice(0, 60)),
    };
  });
  if (!before) return JSON.stringify({ ok: false, err: 'NO_VISIBLE_QUIZ' });

  const clicked = [];
  for (const idx of PICKS) {
    // 1) 点 label（不是 li）
    const r = await mod.evaluate((i) => {
      const li = [...document.querySelectorAll('.ans-videoquiz-opt')][i];
      if (!li) return { err: 'missing' };
      const lbl = li.querySelector('label');
      const radio = li.querySelector('input[type=radio]');
      if (lbl) lbl.click();
      return { text: (li.innerText || '').trim().slice(0, 30), checked: radio ? radio.checked : null };
    }, idx);
    await page.waitForTimeout(500);
    // 2) 兜底：label 没选中就直接点 radio
    const r2 = await mod.evaluate((i) => {
      const li = [...document.querySelectorAll('.ans-videoquiz-opt')][i];
      const radio = li ? li.querySelector('input[type=radio]') : null;
      if (radio && !radio.checked) radio.click();
      return { checked: radio ? radio.checked : null, all: [...document.querySelectorAll('.ans-videoquiz-opt input[type=radio]')].map((x) => x.checked) };
    }, idx);
    clicked.push({ ...r, verified: r2 });
    await page.waitForTimeout(400);
  }

  const submitted = await mod.evaluate(() => {
    const b = document.querySelector('#videoquiz-submit') ||
      [...document.querySelectorAll('a')].find((x) => /提交/.test(x.innerText || ''));
    if (!b) return 'no-submit';
    try { b.click(); } catch (e) { return 'ERR ' + String(e).slice(0, 40); }
    return 'clicked';
  });

  await page.waitForTimeout(2500);

  // ★★★ 收尾顺序很重要（踩过坑）：
  //   1) 先点「继续」按钮 —— 这是平台的正规流程，能干净地关掉面板并恢复视频
  //   2) 只有在「继续」不可用时才退而求其次调 play()
  //   ✗ 千万不要一上来就 v.play() 硬推：视频是动起来了，但**面板会残留**，
  //     然后挡住下一个弹题点，整个判断全乱（实测踩过）。
  const cont = await mod.evaluate(() => {
    const b = document.getElementById('videoquiz-continue');
    if (b && (b.offsetWidth || b.offsetHeight)) { b.click(); return 'continue-clicked'; }
    return 'no-continue';
  });
  await page.waitForTimeout(2000);

  const vres = await mod.evaluate(() => {
    const q = document.querySelector('.ans-videoquiz');
    const v = document.querySelector('video');
    if (q && (q.offsetWidth || q.offsetHeight)) {
      // 「继续」没出现 —— 面板还在。隐掉它，避免残留在视频上
      try { q.style.display = 'none'; } catch (e) {}
    }
    if (v && v.paused) {
      v.playbackRate = 2;
      const p = v.play();
      if (p && p.catch) p.catch(() => {});
      return 'play-fallback';
    }
    return 'already-playing';
  });
  await page.waitForTimeout(2500);

  const after = await mod.evaluate(() => {
    const q = document.querySelector('.ans-videoquiz');
    const v = document.querySelector('video');
    const vis = (id) => { const e = document.getElementById(id); return !!(e && (e.offsetWidth || e.offsetHeight)); };
    return {
      quizStillVisible: !!(q && (q.offsetWidth || q.offsetHeight)),
      showCorrect: vis('spanHas'),
      showWrong: vis('spanNot'),
      videoPaused: v ? v.paused : null,
      videoTime: v ? Math.round(v.currentTime) : null,
      feedback: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 140),
    };
  });

  return JSON.stringify({ ok: true, quiz: before, picked: clicked, submit: submitted, after });
}
