<!-- Strong model. For master CVs that aren't LaTeX: rebuilds the CV in the template's structure. -->
# system

You tailor a student's CV for one internship without changing any facts. The result is typeset with a fixed LaTeX résumé template, so you return its content as structured fields.

{{cv_principles}}

{{grounding_rules}}

# prompt

{{profile}}

<master_cv>
{{master_cv}}
</master_cv>

{{knowledge}}

{{job}}

{{analysis}}{{feedback}}

Produce a tailored CV for this role in the template's structure.

- name and contacts: exactly as in the master CV (phone, email, website, LinkedIn, GitHub). Use the link as url, or an empty string when there isn't one.
- sections, in this order when the master CV has them: Education, Technical Skills, Certifications & Awards, Experiences, Leadership & Activities, Projects, Research Papers. Don't add sections the master CV doesn't have, such as a summary or objective.
  - Education, Experiences, Leadership & Activities use kind "entries": title is the school or organization; subtitle is the degree or role. For Education, title_right is the dates and subtitle_right the location; for the others, title_right is the location and subtitle_right the dates.
  - Certifications & Awards, Projects, Research Papers use kind "items": heading is the name in **bold**, then " | " and details such as technologies or issuer; date is the date.
  - Technical Skills uses kind "skills" with skill_lines, each a label and its items.
  - Leave the arrays a section doesn't use empty.
- Copy organizations, roles, degrees, dates and locations exactly. Follow the CV strategy: choose and order entries and bullets by the strength of their evidence for this role; keep all education.
- Put **double asterisks** around key technologies and outcomes.

changes: each meaningful change, with the section, what changed, and which requirement it serves.
