# NZ Visa Auto Push

NZ Visa Auto Push is a private licensed automation assistant for New Zealand Working Holiday application preparation. It is designed to help applicants quickly complete repetitive form fields while keeping CAPTCHA, final legal submission, and payment under human control.

This public repository is a product introduction and user guide only. It does not contain the private automation source code, compiled runtime, license private key, real applicant data, or production release package.

## Highlights

- Fast application-entry watching for high-demand Working Holiday openings.
- Immediate `Apply Now` click when the application button becomes available.
- Automatic form filling for Personal, Identification, Health, Character, and Working Holiday specific pages.
- Manual CAPTCHA handoff: users solve CAPTCHA themselves, then the tool continues.
- Final manual takeover before real government submission and payment.
- Licensed package model: customer builds can be locked to a person's name and date of birth.
- Private release package for Windows users with double-click launch scripts.

## User Flow

1. Receive a licensed private zip package from the developer.
2. Extract the zip on a Windows computer.
3. Run `install-browser.bat` once.
4. Run `run-test-pre-submit.bat` for the Germany rehearsal flow.
5. Run `run-real-china-pre-submit.bat` for the real China flow.
6. Complete CAPTCHA manually if the website asks for it.
7. Review the final confirmation page manually before any real submission or payment.

## What Customers Can Edit

The private package includes a `config/applicant.json` file. Customers can update normal application details such as address, contact number, passport information, and answers that need to match their real situation.

Licensed builds can lock the applicant name and date of birth. If those locked fields are changed, the package will refuse to run.

## Safety Boundaries

- This tool does not bypass CAPTCHA, MFA, payment checks, or government security flows.
- This tool does not perform the final legal submission automatically.
- Applicants are responsible for checking every answer before submitting.
- Use only one account/session per applicant to avoid account conflicts.

## Public Files

- `docs/USER-RUNBOOK.md`: customer-side running guide.
- `docs/PACKAGING-FLOW.md`: private packaging workflow overview.
- `docs/SAFETY.md`: usage boundaries and responsibility notes.
- `config/applicant.example.json`: sanitized example applicant config.
- `config/site.public.example.json`: non-production example site config shape.
- `config/license-policy.example.json`: public explanation of locked license fields.

## Private Files Not Included

- `src/`
- `dist/`
- `.secrets/`
- `config/applicant.json`
- `config/license.json`
- `release/*.zip`
- Any real customer identity, passport, login, or payment information

## Contact

For licensed access or setup support, contact the developer.

- WeChat: `Lipfrak`
- Email: `huhaiaisa@gmail.com`
