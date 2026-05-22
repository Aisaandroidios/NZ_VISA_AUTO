# Private Packaging Flow / 私有授权包打包流程

## 中文

本公开仓库不包含私有打包器、自动化源码或编译后的运行文件。本文件只说明授权包的发布思路。

### 发布者流程

1. 准备客户的 `config/applicant.json`。
2. 根据客户姓名和出生日期签发许可证。
3. 构建私有授权运行包。
4. 只把生成的 zip 包发给客户。

### 授权锁定字段

当前授权策略可以锁定：

- `profile.familyName`
- `profile.givenName`
- `profile.givenName2`
- `profile.givenName3`
- `profile.otherNames`
- `profile.dateOfBirth`

也就是锁定姓名和出生日期。客户仍然可以修改地址、电话、护照、问答等实际填写信息，但不能把授权包轻易改成另一个人的身份使用。

### 不应放进公开仓库的内容

- 私有源码
- 编译后的运行文件
- 签名私钥
- 真实客户配置
- 已签发的许可证
- 浏览器会话文件夹
- 发布 zip 包

### 发布检查

- zip 包里没有 `.secrets/`。
- zip 包里没有开发源码。
- zip 包里的 `config/applicant.json` 是当前客户信息。
- zip 包里的许可证能通过启动校验。
- 公开 GitHub 仓库只包含文档和示例配置。

## English

This public repository does not include the private packager, automation source code, or compiled runtime. This document only explains the private licensed release model.

### Publisher Flow

1. Prepare the customer's `config/applicant.json`.
2. Issue a license based on the customer's name and date of birth.
3. Build the private licensed runtime package.
4. Send only the generated zip package to the customer.

### Locked License Fields

The current license policy can lock:

- `profile.familyName`
- `profile.givenName`
- `profile.givenName2`
- `profile.givenName3`
- `profile.otherNames`
- `profile.dateOfBirth`

This locks the applicant's name and date of birth. Customers can still edit practical form values such as address, phone number, passport details, and questionnaire answers, but cannot casually change the package to another person's identity.

### Files That Must Not Be Published

- private source code
- compiled runtime
- signing private key
- real customer config
- issued license file
- browser session folders
- release zip packages

### Release Checklist

- The zip package does not contain `.secrets/`.
- The zip package does not contain development source code.
- `config/applicant.json` in the zip belongs to the current customer.
- The license in the zip passes startup validation.
- The public GitHub repository contains documentation and example config only.
