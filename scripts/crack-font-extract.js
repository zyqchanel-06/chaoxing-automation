/**
 * 提取学习通「字体反爬」字体（font-cxsecret）
 *
 * 用法：
 *   playwright-cli -s=<会话> --raw run-code --filename "<skill>/scripts/crack-font-extract.js"
 *   → 返回 base64 字符串（约 14KB），在 PowerShell 侧解码落盘：
 *
 *   $raw = playwright-cli -s=<会话> --raw run-code --filename "<skill>/scripts/crack-font-extract.js" | Out-String
 *   $b64 = $raw.Trim().Trim('"')
 *   [IO.File]::WriteAllBytes("cxsecret.ttf", [Convert]::FromBase64String($b64))
 *
 * 前提：当前页面必须已在作业/测验页（frame URL 含 doHomeWorkNew）。
 */
async (page) => {
  const f = page.frames().find(x => x.url().includes('doHomeWorkNew'));
  if (!f) return 'NO_FRAME';
  return await f.evaluate(() => {
    let b64 = '';
    for (const ss of document.styleSheets) {
      let rules; try { rules = ss.cssRules; } catch (e) { continue; }
      if (!rules) continue;
      for (const r of rules) {
        if (r.constructor && r.constructor.name === 'CSSFontFaceRule' && /cxsecret/.test(r.style.fontFamily || '')) {
          const m = (r.style.src || '').match(/base64,([A-Za-z0-9+/=]+)/);
          if (m) b64 = m[1];
        }
      }
    }
    return b64;
  });
}
