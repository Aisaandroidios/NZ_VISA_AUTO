# NZ Visa Auto Push

这是一个以 `Playwright` 为核心的“极速填写/提交框架”。它的目标不是高并发轰炸，也不包含验证码绕过，而是把所有可前置动作提前完成，在开放时点以单会话、确定性流程完成最后提交。

## 适用方式

适合以下流程：

- 需要登录后进入表单
- 大量字段、附件可提前准备
- 可以先停在最终确认页
- 开放时点后只差最后一次确认/提交

不适合以下流程：

- 需要绕过验证码、Cloudflare、MFA 安全机制
- 需要模拟高并发、刷接口、规避站点保护
- 需要依赖内部接口逆向或不公开参数

## 项目结构

- `config/applicant.example.json`: 个人资料、证件号、附件路径
- `config/site.example.json`: 目标网站 URL、步骤定义、选择器、提交模式
- `src/index.ts`: 入口
- `src/config.ts`: 配置加载与校验
- `src/engine.ts`: Playwright 执行动作引擎
- `src/submit.ts`: 手动/定时提交流程

## 使用步骤

1. 安装依赖：

```bash
pnpm install
```

2. 复制示例配置：

```bash
mkdir -p config
cp config/applicant.example.json config/applicant.json
cp config/site.example.json config/site.json
cp .env.example .env
```

3. 修改 `config/applicant.json`：

- 填写申请人信息
- 把附件路径改成你的本机绝对路径

4. 修改 `config/site.json`：

- 把 URL 改成真实目标页面
- 把各步骤的 CSS/XPath 选择器改成真实页面结构
- 默认 `submit.mode` 是 `manual`

5. 运行：

```bash
pnpm run run -- --site config/site.json --applicant config/applicant.json
```

## 提交模式

### `manual`

脚本会一路跑到最终提交前，等待你在终端按回车后才点击提交按钮。适合先调试选择器和流程。

### `armed-auto`

脚本会在最终提交前等待到 `submit.releaseAt` 指定时间，然后自动执行最后勾选和提交。建议只在流程已经稳定后使用。

时间格式建议写绝对时间并带时区，例如：

```json
"releaseAt": "2026-05-14T10:00:00+12:00"
```

## 动作定义

`phases` 由一系列动作组成，支持：

- `goto`
- `waitFor`
- `waitForOpen`
- `waitForUrlChange`
- `click`
- `fill`
- `select`
- `check`
- `upload`
- `press`
- `sleep`
- `screenshot`
- `pause`

所有字符串字段支持模板变量，例如：

```json
"url": "${site.urls.login}"
"value": "${applicant.credentials.email}"
"path": "${applicant.files.passportBio}"
```

`pause` 动作用于需要人工介入的节点，例如官网登录验证码、短信验证、人工确认页面。它会在终端停住，等你处理完浏览器中的步骤后按回车继续。
如果官网在任意步骤中临时跳出 `CAPTCHA` 或 `rs-captcha` 页面，执行引擎会自动进入等待状态；你只需要在浏览器里手动完成验证，脚本会在验证码页面消失后自动继续，不需要额外回终端按回车。

`Occupation details` 这一页建议按“辅助搜索 + 人工确认”处理，而不是强行自动选择。因为官网的行业搜索词很容易出现 `NO RESULTS WERE FOUND FOR YOUR SEARCH`，或者返回的分类并不准确。更稳妥的做法是：
- 脚本先把行业和职业搜索词填好并触发搜索
- 如果结果正确，你手动点选真实项
- 如果行业没搜出来，先不要硬选错误分类；可以保留到人工补全，或者先用 `Complete Later` 保存草稿，等正式提交前再回到这一页完成

`waitForOpen` 用于“已经登录并停在抢名额页面”的场景。它会在开放前按 `preReleaseIntervalMs` 低频刷新保活，到 `releaseAt` 后切到 `intervalMs` 高频轮询，直到目标选择器出现。

示例：

```json
{
  "name": "Wait for Apply Now",
  "action": "waitForOpen",
  "selector": "text=/apply now/i",
  "releaseAt": "${site.submit.releaseAt}",
  "preReleaseIntervalMs": 30000,
  "intervalMs": 1000,
  "timeoutMs": 3600000,
  "reload": true
}
```

`waitForUrlChange` 用于需要人工完成登录或验证码，但脚本应自动继续的场景。典型用法是：打开登录页后等待 URL 变化，表示你已经完成登录，随后脚本自己进入等待页。

## 选择器建议

- 优先用稳定的 `data-testid`
- 其次用 `name`、`id`
- 少用脆弱的深层 CSS 路径
- 页面变更频繁时，先用浏览器开发者工具逐步验证

## 运行建议

- 提前登录并复用浏览器数据目录
- 提前上传文件并走到最终确认页
- 只保留单个主会话，避免自己触发风控
- 开放前 2 到 5 分钟开始运行
- 每次实战前先完整演练一次

## 跨电脑运行

- Windows 直接用根目录里的 `run-real-china-pre-submit.bat` 或 `run-test-pre-submit.bat`
- macOS 直接用根目录里的 `run-real-china-pre-submit.command` 或 `run-test-pre-submit.command`
- 这些启动脚本现在都会以“脚本自身所在目录”为工作目录，不依赖固定盘符或绝对路径
- 在新电脑第一次运行前，先安装 Node.js、pnpm，然后执行 `pnpm install`
- Playwright 浏览器未安装时，再执行一次 `npx playwright install chromium`
- macOS 如果双击 `.command` 没反应，先在终端执行 `chmod +x run-*.command`

## 后续可加

- 会话保活
- 登录状态检测
- OTP/MFA 人工暂停点
- 失败截图与重入点
- 多申请人配置切换

## 中国 Working Holiday 模板

如果你的线路是中国护照的 `Working Holiday Visa`，可以从这个模板开始：

- `config/site.china-whs.example.json`

这个模板已经写入了官方入口地址，并默认把登录/CAPTCHA 处理设计为人工暂停点。

按 `2026年4月13日` 官方中国线路页面显示，这一轮会在 `2026年7月2日 10:00 NZST` 开放。模板里已经预填了这个绝对时间：

```json
"releaseAt": "2026-07-02T10:00:00+12:00"
```

如果官方后续改时间，你需要同步更新该字段。

这个模板还加入了 `holding` 阶段，专门处理“提前登录后蹲守中国开放页”的情况。默认做法是：

- 登录成功后进入中国线路等待页
- 开放前每 30 秒低频刷新
- 到 `2026年7月2日 10:00 NZST` 后每 1 秒轮询一次
- 一旦检测到 `Apply Now` 文本出现，立刻进入下一步
