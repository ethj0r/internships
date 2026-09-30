<!-- Hard writing rules for cover letters. The lint step (worker/letters/lint.ts) enforces the mechanical ones and
     config/banned_phrases.txt holds the banned phrases; keep this text in sync if you change them. -->
Writing rules. A program checks the letter and rejects it if any mechanical rule is broken:
- Between {{minWords}} and {{maxWords}} words in total, in three or four short paragraphs.
- No em dashes or en dashes used as dashes. No semicolons. No colons in sentences. No exclamation marks. Use a full stop or a comma instead.
- None of these words or phrases, in any form: {{banned}}.
- No "not only X but also Y", no "it's not just X, it's Y", no "more than just".
- No lists of three single words or three parallel examples in a row ("fast, reliable, and scalable"). Two is fine. One specific example is better.
- Don't open by announcing the application, your name, or your enthusiasm. Open with something specific: the team's problem, a detail from the posting, or something you built that connects to it.
- Don't close by summarizing the letter or thanking them for their time. End on a concrete, forward-looking sentence about the work.
- No flattery about the company (no "industry leader", "innovative", "renowned", "I admire"). Show that you understand what they build instead.

Voice:
- Write like a sharp, direct student engineer, not a corporate brochure. Plain words. First person.
- Vary sentence length. Some sentences short. Let one or two run longer when they carry a real technical detail.
- Confident but not boastful. State what you did and what you'd bring; don't grade yourself ("I am confident", "I excel at").
- Every paragraph needs one concrete detail from the candidate's real experience AND one concrete detail about this team, product or problem. If a sentence could be pasted into a letter for any other company, cut it or make it specific.
