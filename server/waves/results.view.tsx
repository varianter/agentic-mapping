import type { Group } from '../domain/groups';
import { type QuestionResult, type Section, type Share, type Tally } from '../domain/surveyResults';
import { OFFICES, phrase, ROLES, surveyFor, type Option, type Subject } from '../domain/survey';
import type { Wave } from '../domain/waves';
import { asset } from '../framework/assets';
import { Layout } from '../shell/Layout';

export type ResultsProps = { group: Group; wave: Wave; roles: string[]; offices: string[]; n: number; opened: number; drafts: number; sections: Section[] };

const percent = (count: number, of: number) => (of ? Math.round((count / of) * 100) : 0);

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

function Shares({ shares, label }: { shares: Share[]; label: string }) {
  return (
    <ul class="results-bars" aria-label={label}>
      {shares.map((item) => (
        <li>
          <span class="results-label">{item.label}</span>
          <progress max="100" value={item.average} aria-label={`${item.label}: ${item.average}% of use on average`}>{`${item.average}%`}</progress>
          <span class="results-count">{`${item.average}% · ${item.users}`}</span>
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
  if (result.kind === 'shares') {
    return (
      <section class="survey-question results-question">
        <h3 class="survey-prompt">{prompt}</h3>
        <p class="hint">Average share of each provider’s use · how many use it. Only splits that add up to 100% count.</p>
        {result.answered ? (
          <>
            <h4 class="results-subhead">{`By size of model, across providers · ${result.answered} splits`}</h4>
            <Shares shares={result.sizes} label="By size of model" />
            {result.providers.map((provider) => (
              <>
                <h4 class="results-subhead">{`${provider.label} · ${provider.answered} ${provider.answered === 1 ? 'split' : 'splits'}`}</h4>
                <Shares shares={provider.tiers} label={provider.label} />
              </>
            ))}
          </>
        ) : <p class="hint">No splits yet.</p>}
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

const labels = (options: Option[], values: string[]) => values.map((value) => options.find((item) => item.value === value)?.label ?? value).join(', ');

// One filter: tick none for everyone.
function Filter({ legend, name, options, picked }: { legend: string; name: string; options: Option[]; picked: string[] }) {
  return (
    <fieldset>
      <legend class="lbl">{legend} <span class="hint">(none for everyone)</span></legend>
      <div class="chips">
        {options.map((item) => <label class="chip"><input type="checkbox" name={name} value={item.value} checked={picked.includes(item.value)} /><span>{item.label}</span></label>)}
      </div>
    </fieldset>
  );
}

// A wave's results for interviewers: submitted answers only, filterable by offices (from v2) and roles.
export function ResultsPage({ group, wave, roles, offices, n, opened, drafts, sections }: ResultsProps) {
  const base = `/${group.slug}/waves/${wave.id}`;
  const asksOffice = surveyFor(wave.version).steps.some((step) => step.questions.some((question) => question.name === 'office'));
  const from = [labels(OFFICES, offices), labels(ROLES, roles)].filter(Boolean).join(' · ');
  return (
    <Layout title={`Results · ${wave.name}`}>
      <main class="groups-page results-page">
        <header class="groups-head">
          <img src={asset('img/variant-logo-dark.svg')} alt="Variant" width="101" height="24" />
          <h1>{wave.name} <span class="pill" data-variant={wave.status}>{wave.status === 'open' ? 'Open' : 'Closed'}</span></h1>
          <p id="results-count">{`${group.name}: ${n} ${n === 1 ? 'answer' : 'answers'}${from ? ` from ${from}` : ''}${drafts ? ` · ${drafts} in progress, not counted` : ''}${from ? '' : ` · ${opened} opened the survey`}.`}</p>
        </header>

        <nav class="group-row-links" aria-label="Wave">
          <form method="get" action={base} class="results-filter">
            {asksOffice && <Filter legend="Office" name="office" options={OFFICES} picked={offices} />}
            <Filter legend="Role" name="role" options={ROLES} picked={roles} />
            <button type="submit" class="btn" data-variant="small">Filter</button>
          </form>
          <a class="btn" data-variant="small" href={`${base}.csv`} download>Download CSV</a>
          <form method="post" action={`${base}/${wave.status === 'open' ? 'close' : 'reopen'}`}>
            <button type="submit" class="btn" data-variant="small">{wave.status === 'open' ? 'Close wave' : 'Reopen'}</button>
          </form>
        </nav>

        {sections.map((section) => (
          <section class="results-section" aria-label={section.title}>
            <h2>{section.title} <span class="hint">{`${section.n} ${section.n === 1 ? 'answer' : 'answers'}`}</span></h2>
            {section.questions.map((result) => <Result result={result} subject={section.subject} />)}
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
