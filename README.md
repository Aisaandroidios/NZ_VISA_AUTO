# NZ Visa Auto Push

## 中文

NZ Visa Auto Push 是一款私有授权的新西兰 Working Holiday 申请辅助工具，用来帮助申请人快速完成重复性的网页表单填写。工具的定位是“填表辅助”，验证码、最终法律提交、付款和最终确认仍然由申请人本人手动完成。

本公开仓库只用于产品介绍、用户说明和示例配置展示，不包含私有自动化源码、编译后的运行文件、签名私钥、真实申请人资料或正式发布包。

### 核心功能

- 监听高需求 Working Holiday 入口开放状态。
- `Apply Now` 按钮出现后立即点击。
- 自动填写 Personal、Identification、Health、Character、Working Holiday Specific 等页面。
- 遇到 CAPTCHA 时自动暂停，由用户手动完成后继续。
- 停在最终真实提交和付款前，由用户人工接管。
- 授权包可锁定申请人的姓名和出生日期，避免被随意改给别人使用。
- Windows 用户可通过双击脚本完成安装、测试和正式运行。

### 用户运行流程

1. 从开发者处获得私有授权 zip 包。
2. 解压 zip 到本机文件夹。
3. 第一次使用时运行 `install-browser.bat`。
4. 正式申请前先运行 `run-test-pre-submit.bat` 做德国测试流程。
5. 中国正式申请时运行 `run-real-china-pre-submit.bat`。
6. 如果网页出现 CAPTCHA，用户在浏览器里手动完成。
7. 到最终确认页后，用户自己检查所有信息并决定是否继续提交和付款。

### 用户可以修改什么

私有授权包里会包含 `config/applicant.json`。用户可以根据真实情况修改地址、联系电话、护照信息、健康问题、品行问题和 Working Holiday 专属问题等内容。

授权包可以锁定姓名和出生日期。如果用户修改这些被锁定字段，程序会拒绝运行。

### 安全边界

- 不绕过 CAPTCHA、MFA、支付验证或政府网站安全流程。
- 不自动点击最终真实提交。
- 不自动付款。
- 申请人必须自己检查所有信息是否真实准确。
- 每个申请人建议只使用一个账号和一个浏览器会话，避免账号冲突。

## English

NZ Visa Auto Push is a private licensed assistant for New Zealand Working Holiday application preparation. It helps applicants quickly complete repetitive web form fields while keeping CAPTCHA, final legal submission, payment, and final review under human control.

This public repository is for product introduction, user guidance, and sanitized example configuration only. It does not contain the private automation source code, compiled runtime, signing private key, real applicant data, or production release package.

### Highlights

- Watches high-demand Working Holiday entry pages.
- Clicks `Apply Now` immediately when the button becomes available.
- Fills Personal, Identification, Health, Character, and Working Holiday Specific pages.
- Pauses for manual CAPTCHA handling and continues after the page clears.
- Stops before final real submission and payment for manual takeover.
- Licensed packages can lock applicant name and date of birth.
- Windows users can install, test, and run through double-click scripts.

### User Flow

1. Receive a private licensed zip package from the developer.
2. Extract the zip on the local computer.
3. Run `install-browser.bat` once before first use.
4. Run `run-test-pre-submit.bat` for the Germany rehearsal flow.
5. Run `run-real-china-pre-submit.bat` for the real China flow.
6. Complete CAPTCHA manually if the website asks for it.
7. Review the final confirmation page manually before any real submission or payment.

### What Customers Can Edit

The private package includes `config/applicant.json`. Customers can update address, contact number, passport details, health answers, character answers, and Working Holiday specific answers according to their real situation.

Licensed builds can lock the applicant name and date of birth. If those locked fields are changed, the package refuses to run.

### Safety Boundaries

- The tool does not bypass CAPTCHA, MFA, payment checks, or government security flows.
- The tool does not click the final real submission automatically.
- The tool does not make payment automatically.
- Applicants must check that all information is truthful and accurate.
- One applicant should use one account and one browser session to avoid account conflicts.

## Repository Contents / 仓库内容

- `docs/USER-RUNBOOK.md`: 用户运行说明 / customer runbook
- `docs/PACKAGING-FLOW.md`: 私有授权包打包流程 / private package flow
- `docs/SAFETY.md`: 安全边界和责任说明 / safety and responsibility notes
- `config/applicant.example.json`: 脱敏申请人配置示例 / sanitized applicant example
- `config/site.public.example.json`: 公开站点配置结构示例 / public site config shape
- `config/license-policy.example.json`: 授权锁定字段示例 / license lock policy example

## Not Published / 不公开内容

- `src/`
- `dist/`
- `.secrets/`
- `config/applicant.json`
- `config/license.json`
- `release/*.zip`
- Any real customer identity, passport, login, or payment information
- 任何真实客户身份、护照、登录账号或付款信息

## Contact / 联系方式

- WeChat / 微信：`Lipfrak`
- Email / 邮箱：`huhaiaisa@gmail.com`
