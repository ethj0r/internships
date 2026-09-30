# Voice samples

Paste a few things you wrote yourself into this folder so cover letters sound like you. Every `.md` or `.txt` file
here except this README is read at build time and shown to the writing model as a style reference (rhythm, sentence
length, word choice). It's never used as evidence of what you did, and its content isn't copied.

Good samples (300–1,500 words in total is plenty):

- a project README or write-up you wrote without AI help
- a LinkedIn post, a blog post, or a long message explaining something technical
- an essay or report paragraph you're happy with (English)

Tips:

- One file per sample, e.g. `readme-domtraverse.md`, `linkedin-hackfest.txt`.
- Remove anything private (phone numbers, other people's names).
- Samples are git-ignored (`voice_samples/*` in `.gitignore`), so they stay on your machine.
- `npm run dev` picks up changes on reload. Run `npm run deploy` from this machine to ship them to the deployed app.
