# Application automation: what's feasible

The goal was to automate as much of applying as is reliable, legitimate and safe, and never submit anything without
explicit approval. This is the assessment behind the current design.

## Submission APIs

| Platform | Is there an application API? | Can a candidate use it? |
| --- | --- | --- |
| Greenhouse | Yes. The Job Board API accepts `POST /v1/boards/{token}/jobs/{id}` with application data. | **No.** It requires HTTP Basic auth with the *employer's* Job Board API key, and is meant for companies building their own career sites. |
| Lever | Yes. `POST /v0/postings/{company}/{id}` on the Postings API. | **No.** It requires an API key that Lever issues to the company. |
| Ashby | Yes. `applicationForm.submit`. | **No.** It requires an employer API key with candidate write permission. |
| Workday, iCIMS, Taleo, SuccessFactors | No public candidate API. | No. Tenant-specific forms, account creation, bot protection. |
| LinkedIn Easy Apply | No API. | No. Automated access is prohibited by the User Agreement, and accounts get restricted. |
| Indeed Apply | Partner-only integration for ATS vendors. | No. |

## Form automation (headless browsers)

Technically possible, but not appropriate as a default:

- **CAPTCHAs.** Greenhouse and Lever forms commonly use reCAPTCHA or hCaptcha. Bypassing them violates the sites' terms.
- **Terms of service.** Most job sites prohibit automated submissions.
- **Reliability.** Every company customizes questions (demographics, work authorization, custom essays, file formats). Silent failures or wrong answers directly harm the application.
- **Accountability.** An application is a statement made in your name. Each one should be reviewed by you.

## What the app automates

| Step | Automated? |
| --- | --- |
| Finding new internships across sources | Yes, hourly |
| Filtering, deduplicating and ranking by fit | Yes |
| Extracting requirements, deadline, workplace | Yes |
| Role analysis: requirement → evidence map, strategy, cited company research | Yes, on request or before the first document |
| Tailored CV, cover letter, application answers | Drafted on request, **approved by you** |
| Fabrication checks on drafts | Yes, as warnings |
| Checklist, links and copy-ready materials | Yes (Apply Kit) |
| Status progression | Partly: generating a document moves Interested → Preparing; approving the CV moves Preparing → Ready |
| Submitting the application | **No.** You submit on the company's site |
| Marking as Applied | Only after you confirm; the API rejects `status: applied` without `confirmSubmitted: true` |
| Deadline reminders | Yes, daily |

## Human-in-the-loop flow

1. Track an internship from Discover.
2. **Tailor CV** (and optionally a cover letter and answers). Check the tailoring strategy, the before/after for each bullet and the quality review, fix anything it flags, then **Approve**.
3. Open the **Apply Kit**: approved CV (print to PDF), cover letter and answers with copy buttons, application link, deadline, checklist.
4. Submit on the company's site.
5. Confirm in the **Did you submit your application?** sheet. The application moves to Applied with the date, and the event is logged.

## Possible future extensions

- A browser extension that fills a form **you** have open, using your approved materials. You still review and press Submit. This avoids CAPTCHAs and ToS issues because a person is operating the browser.
- Email parsing (with consent) to move applications to Interview or Rejected automatically based on replies.
- If a platform ever offers a candidate-authorized application API (OAuth on the candidate's behalf), add it as an integration that still requires per-application approval.
