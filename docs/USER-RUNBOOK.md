# User Runbook / 用户运行说明

## 中文

本文档适用于已经收到私有授权 zip 包的用户。

### 第一次安装

1. 解压开发者发来的 zip 包。
2. 打开解压后的文件夹。
3. 双击 `install-browser.bat`。
4. 等待脚本检查 Node.js、安装依赖并下载 Playwright 浏览器。
5. 看到安装完成提示后关闭窗口。

这个步骤通常只需要做一次。Windows 如果没有 Node.js，脚本会优先尝试用 `winget` 自动安装。macOS 如果没有 Node.js，会先检查 Homebrew；如果没有 Homebrew，会先安装 Homebrew，再用 Homebrew 安装 Node.js。

### 德国测试流程

正式申请前建议先运行测试流程：

```text
run-test-pre-submit.bat
```

测试流程用于确认浏览器、登录状态、表单填写、CAPTCHA 人工处理和最终确认页是否正常。

### 中国正式流程

正式申请时运行：

```text
run-real-china-pre-submit.bat
```

工具会等待申请入口开放，并在 `Apply Now` 按钮出现后立即点击。进入表单后会自动填写配置中的信息。

### CAPTCHA

如果网站出现 CAPTCHA，请在浏览器中手动完成。工具会等待页面恢复，恢复后继续执行。

### 最终提交

工具会停在最终真实提交和付款前。请用户本人仔细检查所有页面信息，确认无误后再手动完成最终步骤。

### 常见问题

- 浏览器打不开：重新运行 `install-browser.bat`。
- 提示找不到 Node.js：安装 Node.js LTS 后重新运行 `install-browser.bat`。
- 登录失败：检查 `config/applicant.json` 里的 INZ 用户名和密码。
- 许可证不匹配：检查姓名和出生日期是否被修改。
- 网页卡住：先看浏览器是否正在等待 CAPTCHA 或网站响应。

## English

This guide is for customers who have received a private licensed zip package.

### First-Time Setup

1. Extract the zip package from the developer.
2. Open the extracted folder.
3. Double-click `install-browser.bat`.
4. Wait while the script checks Node.js, installs dependencies, and downloads the Playwright browser.
5. Close the window after the install-finished message appears.

This step usually needs to be done only once. On Windows, if Node.js is missing, the script first tries to install it with `winget`. On macOS, if Node.js is missing, the script checks Homebrew first; if Homebrew is missing, it installs Homebrew and then installs Node.js through Homebrew.

### Germany Rehearsal Flow

Before the real application opening, run the rehearsal flow:

```text
run-test-pre-submit.bat
```

The test flow confirms browser setup, login state, form filling, manual CAPTCHA handoff, and final confirmation page access.

### Real China Flow

At the real application time, run:

```text
run-real-china-pre-submit.bat
```

The tool waits for the application entry and clicks `Apply Now` immediately when the button becomes available. After entering the form, it fills values from the configuration.

### CAPTCHA

If CAPTCHA appears, complete it manually in the browser. The tool waits for the page to clear and then continues.

### Final Submission

The tool stops before the final real submission and payment. The applicant must review all page information and complete the final step manually.

### Common Issues

- Browser does not open: run `install-browser.bat` again.
- Node.js is not found: install Node.js LTS and run `install-browser.bat` again.
- Login fails: check the INZ username and password in `config/applicant.json`.
- License mismatch: check whether name or date of birth was changed.
- Page appears stuck: check whether the browser is waiting for CAPTCHA or site response.
