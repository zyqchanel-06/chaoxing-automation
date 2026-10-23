---
name: chaoxing-automation
description: 学习通（超星 / 泛雅 / chaoxing）课件自动化操作手册。用 playwright-cli 驱动已登录的 Edge，刷章节任务点（视频、章节测验）、做作业。当用户说「刷学习通」「学习通刷课」「学习通章节测验」「做学习通作业」时使用。
---

# 学习通课件自动化

浏览器自动化操作手册。**纯 DOM 操作，不依赖截图。**

> **实测环境**：Windows + PowerShell · Edge · playwright-cli 0.1.22 · 某高校
> 实测课程：《马克思主义基本原理》（章节任务点）·《C语言程序设计》（作业）

## 能力矩阵（哪些真跑通过）

| 能力 | 状态 | 实测证据 |
|---|---|---|
| 课程/章节结构、进度读取 | ✅ | `已完成任务点: n/N` 读得准 |
| **视频任务点** | ✅ | 33 分钟片 8 分钟刷完（1.98x），`aria-label` 变「任务点已完成」，进度 +1 |
| **章节测验** | ✅ | 5 题（3多选+2判断）**100 分**，含字体反爬还原 |
| **作业**（mooc2 新版） | ✅ | C语言第三章作业 25 题 **100 分**，列表状态变「已完成」 |
| 文档 / PPT / 音频任务点 | ⏳ | **本机两门课都没遇到**，未实测 |
| 讨论 / 直播 / 录音类 | ⏳ | 未实测 |
| 教师端 | ⛔ | **用户明确暂不做**（没开课），相关描述已移除 |

标 ⏳ 的用之前**先验证再落笔**，别照搬。

---

## 〇、唯一可靠的完成判据（先记住这条）

U校园 那份手册的立身之本是「发了 `POST /course/api/v3/newExploration/submit` 才算完成」。
学习通对应的是**任务点完成上报**，具体接口见第六章（⏳ 待抓）。

**原则不变**：

- 页面看起来像做完了 **不算**，进度条动了 **不算** —— **抓到完成上报才算**。
- 每次动手前后都读一次**课程总进度**（`已完成任务点: n/N`）来交叉验证。

---

## 一、开工前必做

### 1.1 起会话（后台常驻）

```powershell
playwright-cli -s=<会话名> kill-all
Start-Sleep -Seconds 2
playwright-cli -s=<会话名> open --browser msedge --headed --profile "<工作区>\.edge-profile-<会话名>" "https://i.mooc.chaoxing.com/space/index"
Start-Sleep -Seconds 21600     # ★ 后台 job 里钉住
```

**★ 必须放在后台 job 里跑**（DSH：`run_in_background: true`）。前台 shell 一结束，daemon 就死。

**★★ `Start-Sleep` 的秒数 = daemon 的寿命**，到点**准时断**（实测给 21600，18:31 断在起会话后 6 小时整）。
长任务（刷整门课 10+ 小时）**给 86400 起步**，并且编排脚本要能**检测掉线后自动重开**：

```powershell
if ((playwright-cli list 2>&1 | Out-String) -match 'no browsers') {
  playwright-cli -s=chaoxing open --browser msedge --headed --profile "<dir>" "<url>"
}
```

登录态在 profile 里，**重开不用重新登录**，但要重新导航。

| 硬约束 | 说明 |
|---|---|
| `-s=<会话名>` | 多对话并行必带，否则互相抢标签页 |
| `--browser msedge` | 本机只有 Edge |
| `--profile <dir>` | 登录态持久化，**跨调用保持**；跨天可能过期要重登 |
| `tab-select <n>` | 标签页不跨调用保持，每次操作前先切 |

两个会话**不能共用同一 profile**（user-data-dir 锁）。

### 1.2 确认登录态

| 判据 | 值 |
|---|---|
| **已登录** | 空间页 `document.title` = **学校名**；正文含真实姓名 + 「账号管理 / 输入邀请码」 |
| 未登录 | 标题「用户登录」，存在 `#phone` |

**★ 不碰凭据** —— 登录由用户自己扫码/输密码，本手册只驱动已登录的浏览器。

### 1.3 命令适配

**本机是 Windows/PowerShell，不是 bash**。`&&`→`;`、`tail`→`Select-Object -Last`、`sleep`→`Start-Sleep`。
完整对照表见 `references/环境与命令.md`。

**★ 长 JS 写文件传**：`run-code --filename "<绝对路径>"`，别塞命令行。
**★ `--raw`** 去掉代码回显，否则看不到结果。
**★ 中文乱码**：命令开头加 `$OutputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8`。

---

## 二、★ 工作流：从课程章节树驱动

**最高效的入口是章节树，它自带完成度信号。**

```
空间页 → 课程列表 → 课程空间 → 点「章节」 → studentcourse iframe
   ↓
读「已完成任务点: n/N」+ 每个节的「待完成任务点数」
   ↓
挑一个待完成的节 → toOld() 跳进内容页 → 逐个任务点做完
   ↓
回章节树复查进度 → 下一个
```

**★ 关键入口（每个都是实测过的）：**

| 步骤 | 怎么做 |
|---|---|
| 空间页 | `https://i.mooc.chaoxing.com/space/index` |
| 课程列表 | 空间页「课程」链接里抠 `.../visit/interaction?s=<token>`（**去掉尾部 `%27`**） |
| 课程 | `a[href*=stucoursemiddle]` 里有文本的那个 |
| 进课程 | 中继页 302 到 `mooc2-ans.../mycourse/stu?courseid=&clazzid=&cpi=&enc=` |
| 点章节 | `page.getByText('章节', {exact:true}).click()` → `iframe#frame_content-zj` |
| 读进度 | `.chapter_head .xs_head_name` → `已完成任务点: n/N` |
| 选目标 | 节 = `.chapter_item` 且含 `.catalog_sbar`；待完成数 = `.catalog_points_yi` |
| 进内容 | 该节 id `cur<chapterId>` → `toOld(courseId, chapterId, clazzid, 0)` |

**★ 单元可能是串行解锁的**（U校园 是这样）→ 卡住的任务点必须啃下来，不能跳过。学习通是否同样串行 ⏳ 待验证。

---

## 三、页面结构：三层嵌套（★ 别只找一层）

```
studentstudy（主 frame，title=学生学习页面）
 ├─ ul.prev_ul：任务点导航 li#dct1 / li#dct2 / li#tit2(讨论)
 ├─ 目录侧栏
 └─ iframe#iframe → knowledge/cards?...&knowledgeid=<chapterId>&num=<任务点序号>
      └─ iframe.ans-attach-online → ananas/modules/<type>/index.html
```

**同一个问题要在正确的层里问：**

| 要什么 | 在哪一层 |
|---|---|
| 任务点导航、当前是第几个 | 主 frame |
| **完成状态、完成条件** | cards 层 |
| 播放器、文档阅读器 | 模块层（`ananas/modules/*`） |

---

## 四、诊断方法

页面「加载不出来 / 点了没反应」时按序排查：

1. **★ 找错 frame 了** —— 学习通三层嵌套，最常见就是问错了层
2. **`contentDocument` 读到 null** —— 改用 `page.frames()` + `frame.evaluate()`
3. **元素 resolved 但 `not visible`** —— 折叠目录/隐藏容器，改导航函数或先展开
4. **点了没反应** —— 页面有防重复点击锁（如 `isToOldLink`），或 JS click 不触发真实手势链
5. **接口返回** —— `playwright-cli requests` 找目标请求，`response-body <n>` 看内容
6. **★ 原生 alert 劫持页面** —— 报 `does not handle the modal state` 就是它，见 `踩坑记录.md` 四点八；
   用 `playwright-cli dialog-accept` 清掉，**并且每次都主动清**（它会让整轮任务静默空转）
7. **弹窗/遮罩挡住** —— 普通 DOM 遮罩（`.maskDiv` / `.popDiv`），用 JS `el.click()` 绕开

---

## 五、任务点类型对照

| 类型 | 图标 class | 完成条件来源 | 自动 |
|---|---|---|---|
| 视频 | `ans-job-video` | `.task-condition`（本例：观看 ≥90%，**不可拖拽/离开/最小化**） | ⏳ |
| 音频 | `ans-job-audio` | 同上 | ⏳ |
| 文档 / PPT | `ans-job-doc` | ⏳ | ⏳ |
| 章节测验 | 主 frame `li#dct2` | ⏳ | ⏳ |
| 讨论 | 主 frame `li#tit2` | ⏳ | ⏳ |

**★ 完成条件以 `.task-condition` 写的为准** —— 每个任务点可能不同，先读再动手。

---

## 六、★ 完成判据与上报（视频已实测）

### 6.1 上报接口 —— 学习通版的「submit」

```
GET https://mooc1.chaoxing.com/mooc-ans/multimedia/log/a/<cpi>/<hash>
    ?clazzId=<班级id>
    &playingTime=69            ← ★ 已播位置（秒）
    &duration=1973             ← 总时长（秒）
    &clipTime=0_1973
    &objectId=<视频objectId>
    &otherInfo=nodeId_<chapterId>-cpi_<cpi>-rt_d-ds_1-ff_1-be_0_0-vt_1-v_6-enc_<enc>
    &courseId=<课程id>
    &jobid=<任务点id>
    &userid=<用户id>
    &isdrag=3
    &view=pc
    &enc=<服务端签名>            ← ★ 每次数值不同，伪造请求走不通
    &rt=0.9                    ← ★ 完成门槛（90%）
    &dtype=Video
    &attDuration=1973
    &attDurationEnc=<签名>
```

**★ 三条硬结论：**

1. **`playingTime` = 视频播放位置**，不是真实时间 → **倍速能线性加速完成**
2. **`enc` / `attDurationEnc` 是服务端签名**，每次数值不同 → **别伪造请求，让真播放器去发**
3. 有 `rt=0.9` 字段 = 该任务点的完成门槛，**以 `.task-condition` 文案为准**（两者一致）

### 6.2 ★★★ 视频暂停的真因：**鼠标离开了页面**

**症状**：视频播着播着**自己停了**，没有平台提示、没有弹窗、没有验证码，
页面 `visibilityState` 一直是 `visible`、`readyState=4`、缓冲充足、`video.error` 为 null。

**真因**：平台靠「**真实鼠标是否还在这个页面上**」判断用户有没有离开。
光标一移出页面（哪怕窗口还在前台），视频立刻暂停。完成条件文案里那句
「观看时不可离开或将页面最小化」**是字面意思**。

**解法：把鼠标"钉"在页面里** —— 用 Playwright 的**真实**鼠标事件：

```js
await page.mouse.move(x, y);   // ★ 真实 CDP 鼠标事件，平台认这个
```

**★ 反例：别用 `dispatchEvent(new MouseEvent('mousemove'))`** —— 程序化派发**完全不管用**。

| 做法 | 有效速率 |
|---|---|
| `dispatchEvent` 假事件 + 10 秒看门狗 | **0.77x** ❌ |
| `page.mouse.move()` 真实事件 + 2.5 秒间隔 | **1.55x** ✅ |

完整实现见 `scripts/watch-video.js`：每 2.5 秒真实微动鼠标 + 复位倍速 + 检测暂停兜底，
到 `duration × 0.9` 就 `pause()` 并返回 `done`。

```powershell
# 单次调用跑约 4 分钟，外层反复调用直到返回 done:true
playwright-cli -s=<会话> run-code --filename "<skill>\scripts\watch-video.js"
```

### 6.3 ★ 完成状态判据（已完整实测）

| 层级 | 判据 | 实测 |
|---|---|---|
| **任务点** | `.ans-job-icon` 的 **`aria-label`**：`任务点未完成` ↔ `任务点已完成` | ✅ |
| 课程级 | `.chapter_head .xs_head_name` → `已完成任务点: n/N` | ✅ `0/109` → `1/109` |
| 节级 | `.catalog_task .catalog_points_yi`（该节待完成数） | ✅ `2` → `1` |

**★★ 致命细节：完成后 class 不变！**

```html
<!-- 未完成 -->
<div class="ans-job-icon ans-job-video ans-job-icon-clear" aria-label="任务点未完成">
<!-- 已完成 —— class 一模一样，只有 aria-label 变了！ -->
<div class="ans-job-icon ans-job-video ans-job-icon-clear" aria-label="任务点已完成">
```

**→ 判据只能读 `aria-label`。看 class（`ans-job-icon-clear`）会 100% 误判成未完成。**

**★★ 进度条对小数不敏感**：`.catalog_ressbar_width` 的 `width` 是**整数百分比**
（1/109 = 0.9% → 显示 `0%`，还是"没动"的样子）。
**→ 别用进度条判断，用 `n/N` 文本。**

**★ 交叉验证**：任务点 `aria-label` **且** 课程 `n/N` 两处都对上，才算真完成。

---

## 六点五、★ 章节测验全流程（已实测跑通，含满分案例）

**一次完整闭环**：读题 → 作答 → 验证选中 → 提交 → 确认弹窗 → 判分。

### 6.5.1 读题

| 目标 | 选择器 |
|---|---|
| 题目容器 | `.TiMu`（`data` 属性 = 题号） |
| 题型 | `.newZy_TItle` → `【多选题】` / `【判断题】` |
| **题干** | `.Zy_TItle .fontLabel` ← ★ **字体混淆，必须走 `references/字体反爬.md` 的映射表还原** |
| **选项文本** | `li > a`（class `fl after`）← ★ **选项不混淆，直接读** |
| 选项框 | 多选 `li.before-after-checkbox` / 判断 `li.before-after`，都带 `qid` |

**★ 关键分工**：**题干要还原，选项不用** —— 别把干净文本也丢进替换表。

### 6.5.2 作答

点 `li[qid="<qid>"]`（第 n 个选项就 `.nth(n)`）。
两种题型各自绑在 li 上：多选题 `onclick="addMultipleChoice(this)"`、判断题 `onclick="addChoice(this)"`。

**★ 验证选中（提交前必做）：读 `aria-checked`！**

```js
[...q.querySelectorAll('ul.Zy_ulTop > li')].map(li => li.getAttribute('aria-checked'))
// → ["true","true","","true"]  空的即未选
```

**别用 class 判断**（`check_answer_dx` / `check_answer` 名字不统一），`aria-checked` 才是干净的布尔值。

### 6.5.3 ★★★ 提交：确认弹窗在**主 frame**，不在作业 frame！

这是最容易卡住的地方。**三层嵌套的分工**：

| 东西 | 在哪个 frame |
|---|---|
| 题目、选项、`a.btnSubmit`（提交按钮） | **`doHomeWorkNew`**（作业 iframe） |
| **「确认提交？」弹窗 + `#popok` / `#popno`** | **`studentstudy` 主 frame** ← ★ |

**踩法**：在作业 frame 里找确认按钮 → 永远找不到 → 或误点到 `btnSubmit` 的子 `span`，弹窗被关掉却没提交。
**另一个坑**：弹窗开着时 `page.click('a.btnSubmit')` 会 **30s 超时**（`#workpop.maskDiv` 拦截点击）。

**正解**：

```js
// 1) 作业 frame 里点提交（弹窗未开时用 JS click 最稳，绕开遮罩拦截）
await f.evaluate(() => document.querySelector('a.btnSubmit').click());
await page.waitForTimeout(3000);
// 2) ★ 主 frame 里点确认
await page.mainFrame().evaluate(() => {
  const ok = [...document.querySelectorAll('#popok')].filter(p => p.offsetWidth || p.offsetHeight)[0];
  if (ok) ok.click();
});
```

`#popok` 的 **innerText 是动态填的**（就是截图里那个紫色「提交」），**静态 HTML 里文本为空** ——
所以**不能靠文本找它**，要按 id 找。

### 6.5.4 判分与验证

提交后跳到批改页（URL 含 `selectWorkQuestionYiPiYue`）：

| 目标 | 读法 |
|---|---|
| 状态 | 页首 `章节测验 已完成` |
| **成绩** | `本次成绩100分` |
| 逐题 | `我的答案： ABD` + `20.0分` |
| 总得分 | `(\d+(\.\d+)?\s*分)` 取第一个 |

**★ 批改页的题目文本是正常的**（字体反爬只在**作答页**生效）→ 想核对答案，去批改页读比在作答页读省事。

**★ 最终判据仍是课程进度 `n/N`** —— 实测该节两任务点做完后 `1/109 → 2/109`，该节 `.catalog_points_yi` 消失。

---

## 六点六、★ 作业全流程（已实测跑通，含满分案例）

> **注意**：这里的「作业页」是 **mooc2 新版**（`work/dowork`），
> 与上面章节测验的旧版（`doHomeWorkNew`）**结构完全不同**，选择器不能混用。

### 6.6.1 找作业

课程空间 → 点「作业」→ `mooc1.chaoxing.com/mooc2/work/list?courseId=&classId=`（iframe）

```js
[...document.querySelectorAll('li[data]')].map(li => ({
  label: li.getAttribute('aria-label'),   // "第三章作业 ; 未交"
  url:   li.getAttribute('data'),         // ★ 作答页 URL，直接可用
  status: li.querySelector('.status').innerText,   // 已完成 / 未交
}))
```

**★ 作业项的 `data` 属性就是作答页完整 URL**（含 workId / answerId / enc）—— 不用自己拼。

**三种落点，别搞混**：

| URL | 含义 |
|---|---|
| `work/task?...` | 入口，会自动跳转 |
| **`work/dowork?...`** | ★ **作答页**（未交、在有效期内） |
| `work/view?...` | **查看/批改页**（已作答过的作业会落到这里，带「我的答案」「正确答案」） |

**踩法**：想作答却进了 `view` → 说明这作业用户已经做过（或已过期），**别在那儿硬答**。

### 6.6.2 读题（★ 选项是乱序的）

| 目标 | 选择器 |
|---|---|
| 题目容器 | `.questionLi`（`id="question<qid>"`、`data="<qid>"`、`typename="单选题"`） |
| 题干 | `.mark_name` |
| 选项 | `.answerBg[onclick="addChoice(this)"]` |
| **选项字母** | 选项内 `span[data]` 的 **`data` 属性**（不是它的显示文本！） |
| 选项内容 | `.answer_p` |
| **★ 作答结果** | `input#answer<qid>` 的 `value`（空 = 未答） |

**★★ 致命细节：选项被平台乱序了。**

```html
<div class="answerBg" aria-label="C %lf选择" qid="...">
  <span data="C" class="choice... num_option">A</span>   <!-- ★ 显示 A，data 是 C -->
  <div class="answer_p"><p>%lf</p></div>
</div>
```

**显示的 A/B/C/D 是打乱后的位置，`data` 才是原始选项字母。**

→ **作答必须按「选项内容」判断**，按显示字母作答必错。
→ 要"选某个字母"时，用 `span[data="X"]` 反查它所在的 `.answerBg`。

### 6.6.3 作答与验证

```js
// 按内容选定后，点该选项所在容器
[...q.querySelectorAll('.answerBg')].find(o => o.querySelector('span[data]').getAttribute('data') === 'D').click();
```

**★ 提交前用隐藏域复核**：

```js
[...document.querySelectorAll('.questionLi')].map((q,i) =>
  (i+1) + ':' + (document.getElementById('answer' + q.getAttribute('data')).value || '_'))
// → ["1:D","2:B","3:C", ...]
```

**25 题逐题核对，和计划一字不差再提交** —— 这一招实测挡住了所有漏选/错位。

### 6.6.4 提交

```js
document.querySelector('a.completeBtn').click();     // 底部「提交」
// → 弹「提示 / 确认提交？」，在 #workpop 里
[...document.querySelectorAll('#popok')].filter(b => b.offsetWidth || b.offsetHeight)[0].click();
```

**★★ 确认键只能按 `#popok` 找，别按文本找。**

因为 `#popok` 的**文本是动态填的**（显示成「提交」，静态 HTML 里是空的），
而页面上**本来就有另一个文本为「提交」的按钮**（`a.completeBtn`）。

**踩法**：用 `/提交|确定/` 之类的宽泛选择器找确认键 → 反复点到底部那个 `completeBtn`
→ 表现是"点了 3 次确认，弹窗还在，什么都没提交"。

### 6.6.5 结果

提交后跳 `work/prompt`：

| 目标 | 内容 |
|---|---|
| **成绩** | `100分` |
| 提交时间 | `提交时间：09-30 13:13` |
| 重做次数 | `本次作业允许重做 5次，已重做 0次` |
| 按钮 | 「查看详情」/「重做」 |

再回作业列表，该项 `.status` 应变 **`已完成`**。

---

## 六点七、★ 一键启动 / 关闭（批量刷课时的推荐入口）

长任务别每次手敲命令 —— 做成双击即用的脚本，放在工作区里。

| 文件 | 作用 |
|---|---|
| `启动刷课.bat` | 双击启动（内部调 `chaoxing-start.ps1`） |
| `停止刷课.bat` | 双击停止 |
| `chaoxing-start.ps1` | 检查会话 → 检查登录态 → 后台起刷课，写 `brush.pid` |
| `chaoxing-stop.ps1` | 停刷课（连子进程）→ 停会话保持进程 → 关浏览器 |
| `session-hold.ps1` | 开会话 + `Start-Sleep 86400` 钉住，写 `session.pid` |
| `brush-videos.ps1` | 刷课编排本体（导航 → 检查 → 播 → 下一节） |

**启动脚本必须做的三件事**：

1. **会话检测**：`playwright-cli list` 不含会话名 → 起 `session-hold.ps1`
2. **登录态检测**：`eval "() => document.title"` 命中 `用户登录` → **提示用户去登录，然后退出**
   （★ 不能替用户登录）
3. **幂等**：`brush.pid` 存在且进程活着 → 提示"已在运行"，别重复启动

**停止脚本必须做的三件事**：

1. 停刷课 **连子进程**：`Get-CimInstance Win32_Process -Filter "ParentProcessId=$id"` 再杀
2. 停会话保持进程（否则 daemon 会一直占着）
3. `playwright-cli kill-all` 关浏览器 —— **登录态留在 profile 里，下次免登录**

### ★★★ 两个踩过的坑

**① 清理进程时别让命令行自匹配**

```powershell
# ✗ 检测命令自己的命令行里就含 'brush-videos' → 把自己也列进去 → 把自己杀了
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -match 'brush-videos' } | ForEach-Object { Stop-Process -Id $_.ProcessId }

# ✓ 把关键字拆开拼，打断自匹配
$kw = 'brush' + '-videos'
... -match $kw
```

**症状**：命令"跑完没有任何输出" + 被杀的 PID 一直在变（其实是在杀自己）。
**加兜底**：`.ps1` 文件名也放进匹配条件，一次清干净。

**② PS 5.1 里 `Out-File -Append` 并发写会锁死日志**

```
Out-File : 文件"...brush.log"正由另一进程使用，因此该进程无法访问此文件
```

**改用**（打开-写-关，可靠）：
```powershell
[IO.File]::AppendAllText($LogFile, $line + [Environment]::NewLine, [Text.Encoding]::UTF8)
```

**且必须包 try/catch** —— 日志写失败绝不能拖垮主流程。

**★ 脚本文件一律存 UTF-8 **带 BOM****（PS 5.1 读无 BOM 的 UTF-8 中文会变乱码）；
用 `[IO.File]::WriteAllText($p, $c, [Text.UTF8Encoding]::new($true))` 落盘。

---

## 六点八、★★ 视频弹题（视频播到中途会弹题，不答就卡死）

### 6.8.1 现象

视频播到某个时间点（实测第 25 节是在 **14:46 / 总长 17:04**），
播放器上**覆盖一层题目面板，并且暂停视频** —— 不答就永远停在那儿。

```
判断题
在相同的时间内，复杂劳动创造的价值比简单劳动创造的价值多。
○ A、对    ○ B、错      [提交]
```

**这是刷课"看起来卡住"的隐形元凶** —— 脚本不会报错，只是视频进度再也不动。

### 6.8.2 选择器（实测）

| 目标 | 选择器 |
|---|---|
| 弹题容器 | `.ans-videoquiz`（`id="videoquiz-<n>"`，class 含 `x-component ans-videoquiz`） |
| 选项 | `li.ans-videoquiz-opt` |
| 提交 | `a#videoquiz-submit`（class `ans-videoquiz-submit bntLinear fr`） |
| 所在 frame | `ananas/modules/video` |

**可见性判定**：`el.offsetWidth || el.offsetHeight`（容器在 DOM 里但可能未弹出）。

### 6.8.3 ★★★ 弹题「答过就不再出现」

实测：视频完成后**倒回 700 秒重播**，`.ans-videoquiz` **根本不存在**。

**含义**：
1. **一次必须答对** —— 没有重来的机会（至少同一节内）
2. **想抓活的弹题做调试，必须去「没答过」的节**
3. 如果一个视频被卡住过又被人手动答了，就再也复现不了

### 6.8.4 处理流程（自动化闭环）

`watch-video.js` 每轮**优先检测弹题**，命中就立刻返回（别把时间耗在等视频上）：

```js
const q = document.querySelector('.ans-videoquiz');
if (q && (q.offsetWidth || q.offsetHeight)) {
  return { quiz: true, quizId: q.id, text: q.innerText, opts: [...] };
}
```

上层（`brush-videos.ps1`）收到 `quiz:true` → **停下、把现场写进 `pending-quiz.json`、退出**，
等人工智能（或用户）给答案，再用 `answer-videoquiz.js` 作答。

**★ 为什么不硬猜**：弹题不可重来，猜错可能就永久卡死这个任务点。

### 6.8.45 ★★★ 弹题要不要「等人判」—— 结论：**别等，让脚本自答**

**最初设计**：脚本遇弹题 → 停下 → 写 `pending-quiz.json` → 等 AI/人给答案 → 作答。

**实测下来这个设计是亏的**：

| 问题 | 说明 |
|---|---|
| **AI 无法实时响应** | 轮询一次要等好几分钟，容易错过窗口 |
| **轮询极烧 token** | AI 每 4 分钟查一次，一天下来开销巨大（用户明确指出过） |
| **等待期间视频不动** | 白浪费时间 |

**★ 更好的策略（已采用）**：**脚本自己选「对」，AI 不介入**。

**依据（实测统计）**：马原课的弹题全是「教材原文表述型判断题」，
**连续 5 道答案全是「对」** —— 这类题目「对」的占比极高。

**关键前提**：**弹题答错也会关闭面板、视频照常播完**（任务点仍算完成）。
所以"猜错"的代价只是这一题可能扣分，而"卡死"的代价是**任务点直接完不成** —— 两害相权取其轻。

**实现**：

```powershell
# 遇弹题：只留 90 秒窗口，超时自动选 [0]（A/对）
$deadline = (Get-Date).AddSeconds(90)
...
if (-not (Test-Path $ansFile)) {
  BrushLog "QUIZ TIMEOUT -> auto-answering with [0](A/对) as fallback"
  $ans = [PSCustomObject]@{ picks = @(0); note = 'auto-fallback' }
  $picks = '0'
}
```

**★ 保留人工介入的口子**：想让 AI 判某道题时，
在 90 秒内往 `quiz-answer.json` 写 `{"picks":[0]}`（0=对 1=错）即可覆盖兜底。

### 6.8.5 答题脚本

`scripts/answer-videoquiz.js`：

```js
const PICKS = [0];   // 选项下标；判断题 [0]=对 [1]=错
// 1) 点 li 里的 label（★ 不是 li）
// 2) 回读 radio.checked 确认真的选上（★ 不确认就会"没选就提交"）
// 3) 点 #videoquiz-submit
// 4) ★ 主动 v.playbackRate=2 + v.play() 把面板推走
```

**作答成功的判据**：**视频恢复播放、`currentTime` 在涨**。
（`quizStillVisible` **不能**当判据 —— 答完它依然是 `true`；
`spanHas`/`spanNot` 这类状态标记答完也会**全部不可见**，同样判断不出来。）

**★ 判断「弹题是否还需作答」的正确姿势**：别猜状态，**直接 `v.play()` 推一把 + 等 2.5 秒**，
看 `currentTime` 有没有涨 —— 推得动就是已答过，推不动才是真待答。

---

## 七、操作节流（★ 不可省）

自动化比人快得多。**连续提交之间加延迟**，单次会话别连做太多。

`scripts/pace.js` 提供 `throttledPause()` / `paceGuard()`（移植自 U校园 手册）：

- 有音频/视频的题：按素材时长比例等待
- 无素材：等 25~70 秒
- 单次会话：连续 3 题就停手
- 纯阅读页 / 视频页：按平台要求时长走

**学习通 自己的限制更硬**：完成条件文案明写「未完成任务点前，当前视频不可拖拽、观看时不可离开或将页面最小化」
→ **别切标签页、别最小化窗口**，否则可能不计时。

---

## 八、边界与红线

| 红线 | 说明 |
|---|---|
| **考试不自动作答** | 作业/练习可以做；**遇到名字带「考试」的先停下问用户** |
| ★ **别只按名字判断** | **老师会把作业命名为「考试」（用户明确说明）** —— 名字不可靠，要看**老师有没有说明** / 作业性质，拿不准就问 |
| **不碰凭据** | 登录由用户自己完成，本手册只驱动已登录浏览器 |
| **不批量刷** | 照第七章节流，别把账号送进风控 |
| **只写实测过的选择器** | 没实测的一律标 ⏳，不编 |
| **不提交用户没授权的东西** | 讨论区发帖、考试、教师端对外发布等，先问 |

---

## 九、输出体积纪律

`eval` 返回大 JSON 会把回复撑爆 → **每次只返回短字符串或计数**，明细分多次小块取。
用 `--raw` + `JSON.stringify(...).slice(0, N)`。

---

## 参考

- `references/选择器速查.md` — 实测过的选择器（按页面分区）
- `references/踩坑记录.md` — 按主题分组的坑与解法 + **待验证清单**
- `references/环境与命令.md` — ★ Windows/PowerShell 适配（bash 对照表）
- `scripts/pace.js` — 操作节流

**同源手册**：U校园 版（外研社 Unipus）方法论同构，可对照阅读；**选择器完全不通用**。
