# Private Packaging Flow

This repository does not include the private packager or automation source code. It only documents the customer-facing release process.

## Publisher Workflow

1. Prepare the customer's `config/applicant.json`.
2. Issue a license for the customer identity.
3. Build a licensed portable package.
4. Send only the generated zip package to the customer.

## Licensed Fields

The current licensing policy can lock:

- family name
- given name 1
- given name 2
- given name 3
- other names
- date of birth

Other fields can remain editable so customers can correct address, phone, passport, or questionnaire details.

## What Never Goes Into the Public Repository

- source code
- compiled runtime
- private signing key
- real customer config
- issued license file
- browser session folders
- release zip files
