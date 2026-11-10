import type { Child } from 'hono/jsx';
import type { Group } from '../domain/groups';
import { AUTONOMY, labelOf, otherField, phrase, rowField, rowsFor, groupTotal, subjectOf, tierField, type Question, type Subject, type Survey, type SurveyAnswers } from '../domain/survey';
import type { Wave } from '../domain/waves';
import { asset } from '../framework/assets';
import type { FormState } from '../framework/formAction';
import { Layout } from '../shell/Layout';
import { Toolbar } from '../shell/Toolbar';

export type SurveyProps = { group: Group; wave: Wave; survey: Survey; answers: SurveyAnswers; revision: number; submitted: boolean };

const surveyPath = (group: Group) => `/${group.slug}/survey`;

function Head({ group, title, children }: { group: Group; title: string; children?: Child }) {
  return (
    <header class="survey-head">
      <div class="sheet-title">
        <h1>{title}</h1>
        <span class="pill">{group.name}</span>
      </div>
      <img class="sheet-logo" src={asset('img/variant-logo-dark.svg')} alt="Variant" width="101" height="24" />
      {children}
    </header>
  );
}

// The start: what it is, how long it takes, and what happens to the answers.
export function IntroPage({ group, wave, survey, submitted, revision }: SurveyProps) {
  const path = surveyPath(group);
  return (
    <Layout title="Survey">
      <main class="survey" id="survey-intro">
        <Head group={group} title="AI at work" />
        <p class="survey-lead">How do you use AI in your work, and how far has the place you work for come? Your answers, together with everyone else’s, show where we are today; the next wave shows what changed.</p>
        <ul class="survey-facts">
          <li><strong>{`About ${survey.minutes} minutes`}</strong><span>{`${survey.steps.length} short steps, one page each.`}</span></li>
          <li><strong>Anonymous</strong><span>No names: not yours, not your customer’s.</span></li>
          <li><strong>Saved as you go</strong><span>This browser finds your answers again, so you can change them until the survey closes.</span></li>
        </ul>
        <p class="hint">{`Wave: ${wave.name}`}</p>
        <div class="actions survey-start">
          {submitted ? (
            <>
              <a class="btn" data-variant="primary" href={`${path}/done`}>See your summary</a>
              <a class="btn" href={`${path}/1`}>Change your answers</a>
            </>
          ) : (
            <a class="btn" data-variant="primary" href={`${path}/1`} id="survey-start">{revision ? 'Continue' : 'Start'}</a>
          )}
        </div>
      </main>
    </Layout>
  );
}

export function NoSurveyPage({ group }: { group: Group }) {
  return (
    <Layout title="No survey open">
      <main class="notice">
        <h1>No survey is open right now</h1>
        <p>{`${group.name} has no open survey. Use the same link again when you’re asked to answer.`}</p>
        <p><a class="btn" href={`/${group.slug}`}>Go to My map</a></p>
      </main>
    </Layout>
  );
}

const list = (value: SurveyAnswers[string] | undefined) => [value ?? []].flat();
const text = (value: SurveyAnswers[string] | undefined) => (typeof value === 'string' ? value : '');

function Options({ question, values, subject }: { question: Question; values: SurveyAnswers; subject: Subject }) {
  if (question.kind === 'text') {
    return <div class="field survey-text"><textarea id={`q-${question.name}`} name={question.name} aria-labelledby={`q-${question.name}-label`}>{text(values[question.name])}</textarea></div>;
  }
  // One percentage per tier, each family adding up to 100. <model-shares> shows only the families ticked above,
  // each with a running total; without JS every family shows and the server checks the totals on Next.
  if (question.kind === 'shares') {
    const ticked = [values[question.from] ?? []].flat();
    return (
      <model-shares from={question.from}>
        {question.groups.map((group) => (
          <fieldset class="share-group" data-option={group.option} data-ticked={ticked.includes(group.option) ? '' : undefined}>
            <legend>{group.label}</legend>
            <div class="share-tiers">
            {group.tiers.map((item) => {
              const name = tierField(question, item);
              return (
                <label class="share-tier">
                  <span>{item.label}</span>
                  <span class="share-input"><input type="number" name={name} value={text(values[name])} min="0" max="100" step="5" inputmode="numeric" placeholder="0" /><span>%</span></span>
                </label>
              );
            })}
            </div>
            <p class="share-total">Total: <output>{groupTotal(question, group, values)}</output>% of 100%</p>
          </fieldset>
        ))}
      </model-shares>
    );
  }
  if (question.kind === 'matrix') {
    return (
      <>
        {question.legend && (
          <dl class="survey-legend">
            {question.options.filter((item) => item.hint).map((item) => <div><dt>{item.label}</dt><dd>{item.hint}</dd></div>)}
          </dl>
        )}
        {rowsFor(question, values).map((row) => {
          const name = rowField(question, row);
          return (
            <fieldset class="survey-row">
              <legend>{phrase(row.label, subject)}</legend>
              <div class="chips">
                {question.options.map((item) => (
                  <label class="chip"><input type="radio" name={name} value={item.value} checked={text(values[name]) === item.value} /><span>{item.label}</span></label>
                ))}
              </div>
            </fieldset>
          );
        })}
      </>
    );
  }
  // A list of others: one per line without JS; <tool-list> adds one on Enter.
  const other = question.kind === 'multi' && question.other === 'list' ? (
    <div class="field survey-other-list">
      <label class="lbl" for={`q-${otherField(question)}`}>Other</label>
      <span class="hint" id={`q-${otherField(question)}-hint`}>Anything not listed above, one at a time.</span>
      <tool-list>
        <textarea id={`q-${otherField(question)}`} name={otherField(question)} placeholder="One per line" aria-describedby={`q-${otherField(question)}-hint`}>{text(values[otherField(question)])}</textarea>
      </tool-list>
    </div>
  ) : question.other && (
    <label class="chip-other survey-other">Other: <input type="text" name={otherField(question)} value={text(values[otherField(question)])} aria-label={`${phrase(question.prompt, subject)}: other`} /></label>
  );
  if (question.kind === 'single' && question.display === 'select') {
    return (
      <div class="survey-select">
        <select name={question.name} aria-labelledby={`q-${question.name}-label`}>
          <option value="" selected={!text(values[question.name])} disabled>Choose…</option>
          {question.options.map((item) => <option value={item.value} selected={text(values[question.name]) === item.value}>{item.label}</option>)}
        </select>
        {other}
      </div>
    );
  }
  const type = question.kind === 'multi' ? 'checkbox' : 'radio';
  const checked = (value: string) => list(values[question.name]).includes(value);
  if (question.display === 'chips') {
    return (
      <div class="chips">
        {question.options.map((item) => <label class="chip"><input type={type} name={question.name} value={item.value} checked={checked(item.value)} /><span>{item.label}</span></label>)}
        {other}
      </div>
    );
  }
  // Cards: an anchored sentence per option, so each answer means the same thing to everyone. With a list of
  // others, the list stands for Other: the server ticks it while the list has items.
  const listed = question.kind === 'multi' && question.other === 'list';
  return (
    <>
      <div class="survey-options" data-kind={question.kind}>
        {question.options.filter((item) => !(listed && item.value === 'other')).map((item) => (
          <label class="survey-option">
            <input type={type} name={question.name} value={item.value} checked={checked(item.value)} />
            <span><strong>{item.label}</strong>{item.hint && <span class="hint">{item.hint}</span>}</span>
          </label>
        ))}
      </div>
      {other}
    </>
  );
}

// One step: a real form that saves on Next and Back (and as you type, with <autosave-form>).
// Next comes first in the form, so pressing Enter moves on, and first on screen, so focus follows what you see.
// After a refused Next, the title says so, the summary links each question in error and each question says why.
export function StepPage({ group, wave, survey, answers, revision, index, form }: SurveyProps & { index: number; form: FormState }) {
  const step = survey.steps[index];
  const values: SurveyAnswers = form.formError ? { ...answers, ...form.values } : answers;
  const subject = subjectOf(values);
  const path = surveyPath(group);
  const action = `${path}/${index + 1}`;
  const last = index === survey.steps.length - 1;
  const invalid = step.questions.filter((question) => form.fieldErrors[question.name]);
  const title = `${form.formError ? 'Error: ' : ''}${phrase(step.title, subject)} · Step ${index + 1} of ${survey.steps.length}`;
  return (
    <Layout title={title} scripts={['elements/autosave-form.js', 'elements/model-shares.js', 'elements/tool-list.js']}>
      <div class="app">
        <main class="main">
          <Toolbar status={form.formError ? 'Not saved' : form.saved ? 'Saved to server' : ''} state={form.formError ? 'error' : ''}>
            <span class="toolbar-notice">Anonymous. Saved as you go.</span>
          </Toolbar>
          <div class="survey">
            <Head group={group} title={phrase(step.title, subject)}>
              <ol class="survey-progress" aria-label={`Step ${index + 1} of ${survey.steps.length}`}>
                {survey.steps.map((item, i) => (
                  <li aria-current={i === index ? 'step' : undefined} data-done={i < index ? '' : undefined}><span class="visually-hidden">{phrase(item.title, subject)}</span></li>
                ))}
              </ol>
              <p class="survey-step-count">{`Step ${index + 1} of ${survey.steps.length}`}</p>
            </Head>
            <p class="survey-lead">{step.intro}</p>
            <autosave-form status="save-status">
              <form class="survey-step" method="post" action={action} autocomplete="off">
                <input type="hidden" name="revision" value={typeof form.values.revision === 'string' ? form.values.revision : String(revision)} />
                <input type="hidden" name="wave" value={wave.id} />
                {form.formError && (
                  <div class="form-error" role="alert">
                    <p>{form.formError}</p>
                    {invalid.length > 0 && <ul>{invalid.map((question) => <li><a href={`#question-${question.name}`}>{phrase(question.prompt, subject)}</a></li>)}</ul>}
                  </div>
                )}
                {step.questions.map((question) => {
                  const error = form.fieldErrors[question.name]?.[0];
                  const prompt = phrase(question.prompt, subject);
                  const Tag = question.kind === 'text' ? 'section' : 'fieldset';
                  // In the legend (or label), so a screen reader says it with the question.
                  const why = error && <span class="survey-error">{` Error: ${error}`}</span>;
                  return (
                    <Tag class="survey-question" id={`question-${question.name}`} data-invalid={error ? '' : undefined} {...(question.kind === 'text' ? { 'aria-labelledby': `q-${question.name}-label` } : {})}>
                      {question.kind === 'text'
                        ? <h2 class="survey-prompt"><label id={`q-${question.name}-label`} for={`q-${question.name}`}>{prompt}{why}</label></h2>
                        : <legend class="survey-prompt" id={`q-${question.name}-label`}>{prompt}{question.required && <span class="survey-required"> (required)</span>}{why}</legend>}
                      {question.hint && <p class="hint">{phrase(question.hint, subject)}</p>}
                      <Options question={question} values={values} subject={subject} />
                    </Tag>
                  );
                })}
                <div class="survey-nav">
                  {last
                    ? <button type="submit" class="btn" data-variant="primary" formaction={`${action}?go=submit`}>Submit answers</button>
                    : <button type="submit" class="btn" data-variant="primary" formaction={`${action}?go=next`}>Next</button>}
                  <button type="submit" class="btn" formaction={`${action}?go=back`} formnovalidate>Back</button>
                </div>
              </form>
            </autosave-form>
          </div>
        </main>
      </div>
    </Layout>
  );
}

// After Submit: the respondent's own answers mirrored back, with the next rung to reach for. No comparisons.
export function DonePage({ group, wave, survey, answers }: SurveyProps) {
  const path = surveyPath(group);
  const questions = survey.steps.flatMap((step) => step.questions);
  const answer = (name: string) => {
    const question = questions.find((item) => item.name === name);
    const value = text(answers[name]);
    return question && value ? labelOf(question, value) : '';
  };
  const rung = AUTONOMY.findIndex((item) => item.value === answers.autonomy);
  const next = rung >= 0 ? AUTONOMY[rung + 1] : undefined;
  return (
    <Layout title="Thank you">
      <main class="survey" id="survey-done">
        <Head group={group} title="Thank you" />
        <p class="survey-lead">{`Your answers are in for ${wave.name}. Here is where you are, as you described it.`}</p>
        {rung >= 0 && (
          <section class="survey-question" aria-labelledby="ladder-label">
            <h2 class="survey-prompt" id="ladder-label">How you work with AI</h2>
            <ol class="ladder" id="ladder">
              {AUTONOMY.map((item, i) => (
                <li aria-current={i === rung ? 'true' : undefined} data-next={i === rung + 1 ? '' : undefined}>
                  <strong>{item.label}</strong>
                  <span class="hint">{item.hint}</span>
                  {i === rung && <span class="pill">You</span>}
                  {i === rung + 1 && <span class="pill" data-variant="closed">Next</span>}
                </li>
              ))}
            </ol>
            <p class="hint">{next ? `Next rung: “${next.label}”. ${next.hint}` : 'You’re on the top rung. Help others get there.'}</p>
          </section>
        )}
        <dl class="survey-summary">
          {answer('time_saved') && <div><dt>Time saved in a week</dt><dd>{answer('time_saved')}</dd></div>}
          {answer('blocker') && <div><dt>What holds you back</dt><dd>{answer('blocker')}</dd></div>}
          {answer('expectation') && <div><dt>{subjectOf(answers) === 'own' ? 'Your organization' : 'Your customer'}</dt><dd>{answer('expectation')}</dd></div>}
        </dl>
        <div class="actions survey-start">
          <a class="btn" href={`${path}/1`}>Change your answers</a>
          <a class="btn" href={`/${group.slug}`}>Go to My map</a>
        </div>
      </main>
    </Layout>
  );
}
