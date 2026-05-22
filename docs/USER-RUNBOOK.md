# User Runbook

This guide is for customers who receive a private licensed zip package.

## First-Time Setup

1. Extract the zip package.
2. Open the extracted folder.
3. Double-click `install-browser.bat`.
4. Wait until the install window says the runtime install is finished.

## Test Run

Before a real application opening, run the rehearsal flow:

```text
run-test-pre-submit.bat
```

The test flow is used to confirm browser setup, login state, form filling, CAPTCHA handoff, and the final manual review page.

## Real China Flow

At the real application time, run:

```text
run-real-china-pre-submit.bat
```

The tool will watch for the application entry and click `Apply Now` as soon as the button becomes available.

## CAPTCHA

If CAPTCHA appears, complete it manually in the browser. The tool waits and continues after the page clears.

## Final Review

The tool stops before the final real government submission/payment step. Review the page carefully and take over manually.

## Common Fixes

- If the browser does not open, run `install-browser.bat` again.
- If login fails, check the INZ username and password in `config/applicant.json`.
- If the package says the license does not match, check that the applicant name and date of birth were not changed.
