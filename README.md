# NZ Working Holiday 自动填写工具

这个项目用于新西兰 Immigration Online Working Holiday 页面自动填写表单。当前主要目标是中国 Working Holiday 入口；德国配置用于正式前演练，因为流程结构基本一致，适合测试“进入申请、填写、保存、进入确认页、勾选声明”的完整链路。

脚本不会绕过 CAPTCHA，也不会替用户完成最终法律提交或付款。遇到 CAPTCHA 时，请在浏览器里手动完成；脚本会在页面恢复后继续。到 `Confirm Submit` 页面后，脚本会勾选 Yes 声明并停留在最终 `SUBMIT` 前，交给人工确认。

## 目录说明

- `config/applicant.json`：真实申请人资料和 INZ 登录账号。每个人都要改这个文件。
- `config/applicant.example.json`：干净模板，不包含真实账号和证件。
- `config/site.json`：中国真实流程配置。
- `config/site.germany.json`：德国测试流程配置。
- `run-test-pre-submit.bat` / `.command`：德国测试流程。
- `run-real-china-pre-submit.bat` / `.command`：中国真实流程。
- `build-portable.bat` / `.command`：生成可复制给别人的发布包。

## 本机开发运行

第一次在源码目录运行：

```bash
pnpm install
npx playwright install chromium
```

德国测试：

```bash
pnpm run run -- --site config/site.germany.json --applicant config/applicant.json
```

中国真实：

```bash
pnpm run run -- --site config/site.json --applicant config/applicant.json
```

Windows 可以直接双击：

```text
run-test-pre-submit.bat
run-real-china-pre-submit.bat
```

macOS 可以直接运行：

```text
run-test-pre-submit.command
run-real-china-pre-submit.command
```

如果 macOS 提示不能执行，先运行：

```bash
chmod +x *.command
```

## 个人信息怎么改

打开 `config/applicant.json`，按真实申请人修改：

- `credentials.email`：INZ 登录用户名。
- `credentials.password`：INZ 登录密码。
- `credentials.contactEmail`：申请表里的联系邮箱。
- `profile`：姓名、性别、出生日期、出生国家。
- `address`：当前海外地址。
- `identification`：护照和第二证件信息。
- `health`：健康问题。默认示例多为 `No`，请按本人真实情况改。
- `character`：品行问题。请按本人真实情况改。
- `whsSpecific`：Working Holiday 专属问题。请按本人真实情况改。
- `meta.phoneMobile`、`meta.hasCreditCard` 等：联系方式和信用卡声明。

日期格式按官网页面格式填写，例如：

```text
15/08/1998
15/09/2033
```

## 正式中国流程

正式使用时，提前打开：

```text
run-real-china-pre-submit.bat
```

脚本逻辑：

1. 打开 INZ Working Holiday 页面。
2. 如果还没登录，就自动填账号密码登录；如果已经在 Working Holiday 页面，就直接继续。
3. 进入中国入口等待开放。
4. 开放前低频刷新；临近开放和开放后提高检查频率。
5. 一旦 `Apply Now` 按钮出现，立即进入申请。
6. 自动填写 Personal、Identification、Health、Character、WHS Specific。
7. Occupation details 当前按跳过/保存处理，避免自动选错职业分类。
8. 点击前一个 `SUBMIT` 进入 `Confirm Submit`。
9. 自动勾选确认页全部 Yes。
10. 停在最终 `SUBMIT` 前，浏览器保持打开，由人工确认最终提交和后续付款。

## 德国测试流程

正式前用：

```text
run-test-pre-submit.bat
```

德国测试会使用同一套填写逻辑跑到 `Confirm Submit` 页，并自动勾选 Yes。测试时不要点击最终 `SUBMIT`，避免提交真实申请。

## 打包给别的电脑

在本机源码目录运行：

```text
build-portable.bat
```

或：

```bash
pnpm run package:portable
```

生成结果在 `release/` 目录，最新 zip 路径会写入：

```text
release/LATEST-PORTABLE-ZIP.txt
```

发布包特点：

- 包含编译后的 `dist/`，不需要源码。
- 包含 `run-real-china-pre-submit.*` 和 `run-test-pre-submit.*`。
- 不会复制你本机真实的 `config/applicant.json`。
- 发布包里的 `config/applicant.json` 会从干净模板生成，每个人拿到后自己改。

新电脑第一次使用发布包：

1. 安装 Node.js。
2. 解压 zip。
3. Windows 双击 `install-browser.bat`；macOS 运行 `install-browser.command`。
4. 修改 `config/applicant.json`。
5. 先运行德国测试。
6. 确认无误后，正式时间运行中国真实流程。

## 节奏设置

当前策略是“填写快，Next 慢一点”：

- 字段填写/下拉：快速执行。
- `Save`、前一个 `SUBMIT`、`Apply Now`：保持普通速度。
- `Next` 和页面跳转：额外等待，让页面加载稳定。

这些默认值在 `config/site.json` 和 `config/site.germany.json` 的 `defaults` 里：

```json
"defaultActionDelayMs": 80,
"fieldDelayMs": 80,
"clickDelayMs": 800,
"navigationDelayMs": 3500
```

如果网络很慢，可以把 `navigationDelayMs` 调大一点。

## 安全边界

- 不要多人共用同一个 INZ 账号同时运行。
- 不要同时开多个脚本抢同一个账号。
- 不要尝试绕过 CAPTCHA、验证码、风控或支付安全流程。
- CAPTCHA 出现时人工完成即可。
- 最终政府提交和付款必须由申请人自己确认。
