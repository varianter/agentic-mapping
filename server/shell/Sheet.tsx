import type { Child } from 'hono/jsx';
import { asset } from '../framework/assets';
import type { FormState } from '../framework/formAction';
import { DIMENSIONS, DISCIPLINES, LEVELS, QUESTIONS, REFLECTIONS, gridField, withLegacyGrid, type Fields } from '../domain/fields';

// The capture sheet as a real form. Respondents see only their own answers; interviewers see the whole sheet.
// Without JS, Save posts it; <autosave-form> posts the same body as you type, and <sheet-tabs> turns the three
// grids into tabs. Print shows all three.
export type Audience = 'respondent' | 'interviewer';

export function Sheet({ audience, action, revision, fields, pill, form, statusId = 'save-status', children }: {
  audience: Audience; action: string; revision: number; fields: Fields; pill: string; form?: FormState; statusId?: string; children?: Child;
}) {
  const values = form?.formError ? { ...withLegacyGrid(fields), discipline: [], ...form.values } : withLegacyGrid(fields);
  const text = (name: string) => (typeof values[name] === 'string' ? values[name] as string : '');
  const list = (name: string) => [values[name] ?? []].flat();
  const interviewer = audience === 'interviewer';
  return (
    <autosave-form status={statusId}>
      <form class="sheet" id="sheet" method="post" action={action} autocomplete="off">
        <input type="hidden" name="revision" value={typeof form?.values.revision === 'string' ? form.values.revision : String(revision)} />
        <header class="sheet-header">
          <div class="sheet-title">
            <h1>What did you need to learn?</h1>
            <span class="pill">{pill}</span>
          </div>
          <img class="sheet-logo" src={asset('img/variant-logo-dark.svg')} alt="Variant" width="101" height="24" />
        </header>
        {form?.formError && <p class="form-error" role="alert">{form.formError}</p>}

        <section class="who" aria-label="About the conversation">
          {interviewer && (
            <>
              <div class="field">
                <label class="lbl" for="f-name">Name</label>
                <input type="text" id="f-name" name="name" value={text('name')} />
                <label class="lbl" for="f-date">Date</label>
                <input type="date" id="f-date" name="date" value={text('date')} />
                <label class="lbl" for="f-interviewer">Interviewer</label>
                <input type="text" id="f-interviewer" name="interviewer" value={text('interviewer')} />
              </div>
              <fieldset class="field">
                <legend class="visually-hidden">Discipline</legend>
                <span class="lbl" aria-hidden="true">Discipline</span>
                <div class="chips">
                  {DISCIPLINES.map((discipline) => (
                    <label class="chip"><input type="checkbox" name="discipline" value={discipline} checked={list('discipline').includes(discipline)} /><span>{discipline}</span></label>
                  ))}
                  <label class="chip-other">Other: <input type="text" name="discipline_other" aria-label="Other discipline" value={text('discipline_other')} /></label>
                </div>
              </fieldset>
              <div class="field">
                <label class="lbl" for="f-context">Client, domain, team</label>
                <textarea id="f-context" name="context">{text('context')}</textarea>
              </div>
            </>
          )}
          <div class="field">
            <label class="lbl" for="f-good">What really good looks like, to you</label>
            <textarea id="f-good" name="good">{text('good')}</textarea>
          </div>
        </section>

        <sheet-tabs class="dims" aria-label="Three levels, three questions, three dimensions">
          {DIMENSIONS.map((dimension) => (
            <section class="matrix dim-panel" id={`panel-${dimension.key}`} data-dim={dimension.key} data-name={dimension.name} aria-labelledby={`dim-${dimension.key}`}>
              <div class="corner"><h2 id={`dim-${dimension.key}`}>{dimension.name}</h2><span class="hint">{dimension.hint}</span></div>
              {LEVELS.map((level) => <div class="col-head"><strong>{level.name}</strong><span class="hint">{level.hint}</span></div>)}
              {QUESTIONS.map((question) => (
                <>
                  <div class="row-head"><strong>{question.name}</strong>{question.hint && <span class="hint">{question.hint}</span>}</div>
                  {LEVELS.map((level) => (
                    <label class="field cell">
                      <span class="lbl cell-label">{level.name}</span>
                      <span class="visually-hidden">{`${dimension.name}: ${question.name}, ${level.name.toLowerCase()}`}</span>
                      <textarea name={gridField(dimension.key, question.key, level.key)}>{text(gridField(dimension.key, question.key, level.key))}</textarea>
                    </label>
                  ))}
                </>
              ))}
            </section>
          ))}
        </sheet-tabs>

        <section class="reflect" aria-label="Surprises and advice">
          {REFLECTIONS.map((reflection) => (
            <div>
              <label class="lbl" for={`f-${reflection.name}`}>{reflection.label}</label>
              <div class="field"><textarea id={`f-${reflection.name}`} name={reflection.name}>{text(reflection.name)}</textarea></div>
            </div>
          ))}
          {interviewer && (
            <div>
              <label class="lbl" for="f-talk">Talk to next</label>
              <div class="field"><textarea id="f-talk" name="talk_to">{text('talk_to')}</textarea></div>
            </div>
          )}
        </section>

        <div class="sheet-actions">
          <button type="submit" class="btn" data-variant="primary">Save</button>
          {form?.saved && !form.formError && <p class="hint" role="status">Saved.</p>}
        </div>
      </form>
      {children}
    </autosave-form>
  );
}
