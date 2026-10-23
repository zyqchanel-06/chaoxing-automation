/**
 * 把视频拨回开头并开始播放（学习通）
 *
 * 用法：playwright-cli -s=<会话> --raw run-code --filename "<skill>/scripts/reset-video.js"
 *
 * ★★★ 为什么需要它（重要教训）：
 *   平台判定视频任务点完成，看的是**实际观看时长**，不是**播放位置**。
 *   如果视频元素停在末尾（currentTime ≈ duration），脚本会误判"已达 90%"直接报 done，
 *   但服务端**完全不认账** —— aria-label 依然是「任务点未完成」。
 *   （完成条件里那句「未完成任务点前，当前视频不可拖拽」就是在防这个。）
 *
 *   实测：某节 before={t:1239,dur:0}（停在末尾）→ 补刷脚本秒报 DONE，
 *        但课程进度纹丝不动、aria-label 仍是"未完成"。
 *        拨回 0 完整播一遍后才真正算数。
 *
 * 返回：{ before, after }
 */
async (page) => {
  const mod = page.frames().find((f) => f.url().includes('ananas/modules/video'));
  if (!mod) return JSON.stringify({ err: 'NO_VIDEO_MODULE' });
  return await mod.evaluate(() => {
    const v = document.querySelector('video');
    if (!v) return JSON.stringify({ err: 'NO_VIDEO' });
    const before = { t: Math.round(v.currentTime), dur: Math.round(v.duration || 0), paused: v.paused };
    v.currentTime = 0;
    try { v.playbackRate = 2; } catch (e) {}
    const p = v.play();
    if (p && p.catch) p.catch(() => {});
    return JSON.stringify({
      before,
      after: { t: Math.round(v.currentTime), rate: v.playbackRate, paused: v.paused },
      note: 'reset to 0; platform judges by WATCHED duration, not playback position',
    });
  });
}
