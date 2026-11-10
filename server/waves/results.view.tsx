import type { Group } from '../domain/groups';
import { MIN_RESPONSES, type QuestionResult, type Section, type Tally } from '../domain/surveyResults';
import { phrase, ROLES, type Subject } from '../domain/survey';
import type { Wave } from '../domain/waves';
import { asset } from '../framework/assets';
import { Layout } from '../shell/Layout';

export type ResultsProps = { group: Group; wave: Wave; role: string; n: number; drafts: number; hidden: boolean; sections: Section[] };

const percent = (count: number, of: number) => (of ? Math.round((count / of) * 100) : 0);
const tooFew = `Fewer than ${MIN_RESPONSES} answers: hidden, so nobody can be singled out.`;

// One bar per option, in the questionnaire's order: the scales are ordered, so sorting by count would hide that.
function Bars({ tallies, of }: { tallies: Tally[]; of: number }) {
  return (
    <ul class="results-bars">
      {tallies.map((item) => (
        <li>
          <span class="results-label">{item.label}</span>
          <progress max={of || 1} value={item.count} aria-label={`${item.label}: ${item.count} of ${of}`}>{`${percent(item.count, of)}%`}</progress>
          <span class="results-count">{`${percent(item.count, of)}% · ${item.count}`}</span>
        </li>
      ))}
    </ul>
  );
}

function Result({ result, subject }: { result: QuestionResult; subject: Subject }) {
  const prompt = phrase(result.question.prompt, subject);
  if (result.kind === 'text') {
    return (
      <section class="survey-question results-question">
        <h3 class="survey-prompt">{prompt}</h3>
        {result.answers.length ? <ul class="results-texts">{result.answers.map((answer) => <li>{answer}</li>)}</ul> : <p class="hint">No answers.</p>}
      </section>
    );
  }
  if (result.kind === 'matrix') {
    return (
      <section class="survey-question results-question">
        <h3 class="survey-prompt">{prompt}</h3>
        <div class="results-table">
          <table>
            <thead><tr><th scope="col"><span class="visually-hidden">Statement</span></th>{result.rows[0]?.tallies.map((item) => <th scope="col">{item.label}</th>)}<th scope="col">Answers</th></tr></thead>
            <tbody>
              {result.rows.map((row) => (
                <tr>
                  <th scope="row">{row.label}</th>
                  {row.tallies.map((item) => <td data-share={Math.min(4, Math.ceil(percent(item.count, row.answered) / 25))}>{row.answered ? `${percent(item.count, row.answered)}%` : '–'}</td>)}
                  <td>{row.answered}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  }
  return (
    <section class="survey-question results-question">
      <h3 class="survey-prompt">{prompt}</h3>
      <p class="hint">{`${result.answered} answered${result.multi ? ' · several choices each, so shares add up to more than 100%' : ''}`}</p>
      <Bars tallies={result.tallies} of={result.answered} />
      {result.others.length > 0 && <p class="hint">{`Other: ${result.others.join(' · ')}`}</p>}
    </section>
  );
}

// A wave's results for interviewers: submitted answers only, filterable by role, small groups hidden.
export function ResultsPage({ group, wave, role, n, drafts, hidden, sections }: ResultsProps) {
  const base = `/${group.slug}/waves/${wave.id}`;
  return (
    <Layout title={`Results · ${wave.name}`}>
      <main class="groups-page results-page">
        <header class="groups-head">
          <img src={asset('img/variant-logo-dark.svg')} alt="Variant" width="101" height="24" />
          <h1>{wave.name} <span class="pill" data-variant={wave.status}>{wave.status === 'open' ? 'Open' : 'Closed'}</span></h1>
          <p id="results-count">{`${group.name}: ${n} ${n === 1 ? 'answer' : 'answers'}${role ? ` from ${ROLES.find((item) => item.value === role)?.label ?? role}` : ''}${drafts ? ` · ${drafts} in progress, not counted` : ''}.`}</p>
        </header>

        <nav class="group-row-links" aria-label="Wave">
          <form method="get" action={base} class="results-filter">
            <label class="lbl" for="results-role">Role</label>
            <select id="results-role" name="role">
              <option value="" selected={!role}>Everyone</option>
              {ROLES.map((item) => <option value={item.value} selected={role === item.value}>{item.label}</option>)}
            </select>
            <button type="submit" class="btn" data-variant="small">Filter</button>
          </form>
          <a class="btn" data-variant="small" href={`${base}.csv`} download>Download CSV</a>
          <form method="post" action={`${base}/${wave.status === 'open' ? 'close' : 'reopen'}`}>
            <button type="submit" class="btn" data-variant="small">{wave.status === 'open' ? 'Close wave' : 'Reopen'}</button>
          </form>
        </nav>

        {hidden ? <p class="empty-note" id="results-hidden">{tooFew}</p> : sections.map((section) => (
          <section class="results-section" aria-label={section.title}>
            <h2>{section.title} <span class="hint">{`${section.n} ${section.n === 1 ? 'answer' : 'answers'}`}</span></h2>
            {section.hidden ? <p class="empty-note">{tooFew}</p> : section.questions.map((result) => <Result result={result} subject={section.subject} />)}
          </section>
        ))}

        <nav class="groups-foot" aria-label="More">
          <a href={`/${group.slug}/waves`}>All waves</a>
          <a href="/groups">All groups</a>
        </nav>
      </main>
    </Layout>
  );
}
