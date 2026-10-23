# chaoxing-automation

**学习通（超星 / 泛雅）页面自动化技术手册与脚本集**：用 Playwright 驱动**已登录**的浏览器，操作章节任务点、视频播放、章节测验与作业页面。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/zyqchanel-06/chaoxing-automation?color=blue)](https://github.com/zyqchanel-06/chaoxing-automation/releases)
[![Playwright](https://img.shields.io/badge/playwright-cli-0.1.22-green.svg)](https://playwright.dev/)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20PowerShell-lightgrey.svg)](#)

---

## ⚠️ 使用边界（请先读完再看代码）

本仓库是**浏览器自动化与反爬对抗的技术研究记录**，不是"刷课服务"。使用前请确认：

1. **可能违反平台协议** —— 学习通用户协议禁止自动化脚本，检测到可能导致账号受限、进度清零。风险自负。
2. **不得替代本人完成学业** —— 不要用它代替自己上课、做作业、参加考试。课程任务点属于学业任务，代刷可能构成学术不端。
3. **不接触任何凭据** —— 所有脚本只驱动**你自己已经登录**的浏览器，仓库里没有任何登录、验证码识别或账号批量管理代码。
4. **不对平台造成压力** —— 附带的 `pace.js` 是操作节流工具，请在合理频率下使用，不要并发轰炸。

如果上述任何一条你不能接受，请直接关闭本页面。

---

## 这个仓库里有什么

| 组成 | 内容 |
| --- | --- |
| `SKILL.md` | 主手册：会话建立、完成判据、章节流程、风险控制（27KB） |
| `references/踩坑记录.md` | 实战踩过的坑：断线、风控、状态误判、接口返回空列表等（23KB） |
| `references/选择器速查.md` | 实测有效的 DOM 选择器表 |
| `references/字体反爬.md` | **font-cxsecret 混淆字体的还原思路**（技术含量最高的一篇） |
| `references/环境与命令.md` | Windows / PowerShell 下的环境与命令备忘 |
| `scripts/*.js` | 6 个注入式脚本：查状态、保活播放、拨回开头、答弹题、提字体、节流 |
| `scripts/glyph_match.py` | 字形比对还原混淆字体（fontTools + PIL） |

## 技术要点

### 1. 纯 DOM 操作，不依赖截图

整本手册走 `aria-label`、`data-*`、语义化选择器定位元素，不靠 OCR 或图像识别。好处是稳、可断言、可重放。

### 2. 字体反爬还原（`references/字体反爬.md`）

学习通的题目文字用自定义字体 `font-cxsecret` 做混淆：HTML 里是正常 Unicode，但字体把字形映射打乱，人眼看着对、机器抓下来是错字。

还原思路是**字形比对**：

```
混淆字体 glyph 轮廓  ──渲染成位图──┐
                                   ├─ 逐像素比对 ─→ 真实汉字
系统字体 glyph 轮廓  ──渲染成位图──┘
```

`scripts/glyph_match.py` 是这套思路的实现（fontTools 读字形 + PIL 渲染 + numpy 比对）。这部分与学习通本身无关，可以迁移到任何自定义字体混淆场景。

### 3. 完成判据：只认上报，不认"看起来做完了"

手册的核心原则：

> 页面看起来像做完了 **不算**，进度条动了 **不算** —— **抓到完成上报才算**。每次操作前后都读一次课程总进度（`已完成任务点: n/N`）交叉验证。

### 4. 会话保活与断线自愈

`playwright-cli` 的 daemon 寿命等于发起命令里 `Start-Sleep` 的秒数，到点准时断。长任务必须给足秒数，并在编排层检测掉线后自动重开——踩坑记录里有完整的观测数据。

## 前置条件

- Windows + PowerShell（其他平台命令需自行调整）
- [playwright-cli](https://playwright.dev/) 0.1.22 实测可用
- 一个**你自己已经登录**的 Edge 浏览器 profile
- Python 3.8+（仅 `glyph_match.py` 需要，依赖 `fonttools` / `pillow` / `numpy`）

```bash
pip install fonttools pillow numpy
```

## 快速上手

```powershell
# 1. 起会话（必须放后台 job，前台 shell 一结束 daemon 就死）
playwright-cli -s=<会话名> kill-all
playwright-cli -s=<会话名> open --browser msedge --headed --profile "<工作区>\.edge-profile-<会话名>" "https://i.mooc.chaoxing.com/space/index"

# 2. 检查视频任务点状态
playwright-cli -s=<会话名> --raw run-code --filename "scripts/check-video.js"

# 3. 保活播放（含弹题检测）
playwright-cli -s=<会话名> --raw run-code --filename "scripts/watch-video.js"
```

详细的章节流程、判据和风控节奏见 `SKILL.md`。

## 能力矩阵（如实标注）

| 能力 | 状态 | 实测证据 |
| --- | --- | --- |
| 课程/章节结构、进度读取 | ✅ | `已完成任务点: n/N` 读得准 |
| 视频任务点 | ✅ | 33 分钟片 8 分钟播完（1.98x），`aria-label` 变「任务点已完成」，进度 +1 |
| 章节测验 | ✅ | 5 题（3 多选 + 2 判断）满分，含字体反爬还原 |
| 作业（mooc2 新版） | ✅ | 25 题满分，列表状态变「已完成」 |
| 文档 / PPT / 音频任务点 | ⏳ | 实测环境未遇到，**未验证** |
| 讨论 / 直播 / 录音类 | ⏳ | 未验证 |
| 教师端 | ⛔ | 未做 |

标 ⏳ 的部分**用之前先自己验证**，别照搬。

## 已知限制

- 页面改版就失效，选择器集中在 `references/选择器速查.md`，失效时改那里
- 平台有行为风控，高频操作会触发异常提示甚至强制下线（踩坑记录里有实测记录）
- 视频倍速与"任务点已完成"的判定依赖前端事件上报，特殊情况（切页、断网）会丢进度

## License

MIT —— 见 [LICENSE](LICENSE)。许可证覆盖代码与文档的**使用许可**，不构成对违反第三方平台协议的授权；使用风险由使用者自行承担。