import { groupPrefix } from '../domain/groups';
import { coverageCaption, groupLabel, preamble, summaryLine, toolsCaption, tooFewText, waveMeta, type Answer, type Insights, type Person } from '../domain/insights';
import { asset } from '../framework/assets';
import { Layout } from '../shell/Layout';

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Labelled answers are a description list; a list answer (tools) is a list; a lone answer is a paragraph.
function Answers({ answers }: { answers: Answer[] }) {
  const labelled = answers.filter((answer) => answer.label);
  return (
    <>
      {answers.filter((answer) => !answer.label).map((answer) => ('items' in answer
        ? <ul class="insights-items">{answer.items.map((item) => <li>{item}</li>)}</ul>
        : <p class="insights-text">{answer.text}</p>))}
      {labelled.length > 0 && (
        <dl class="insights-answers">
          {labelled.map((answer) => (
            <div>
              <dt>{answer.label}</dt>
              <dd class="insights-text">{'items' in answer ? answer.items.join(', ') : answer.text}</dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}

function PersonCard({ person }: { person: Person }) {
  const id = slug(person.title);
  return (
    <article class="insights-person" id={id} aria-labelledby={`${id}-heading`}>
      <h3 id={`${id}-heading`}>{person.title}</h3>
      {person.parts.map((part) => (
        <div class="insights-part">
          <h4>{part.title}</h4>
          <Answers answers={part.answers} />
        </div>
      ))}
    </article>
  );
}

function People({ id, title, people, none }: { id: string; title: string; people: Person[]; none: string }) {
  return (
    <section class="results-section" id={id} aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>{title}</h2>
      {people.length ? people.map((person) => <PersonCard person={person} />) : <p class="empty-note">{none}</p>}
    </section>
  );
}

const percent = (count: number, of: number) => (of ? Math.round((count / of) * 100) : 0);

// Counts as tiles, the grid as a real table shaded by share (the numbers stay in the cells, so the shade only
// adds), and the top tools as bars. No script: every value is printed.
function Glance({ insights }: { insights: Insights }) {
  const { group, stats } = insights;
  return (
    <section class="results-section insights-glance" id="glance" aria-labelledby="glance-heading">
      <h2 id="glance-heading">At a glance</h2>
      <dl class="survey-summary">
        <div><dt>Interviews</dt><dd>{String(insights.interviews.length)}</dd></div>
        <div><dt>Self-submitted maps</dt><dd>{String(insights.maps.length)}</dd></div>
        {group && <div><dt>Survey responses</dt><dd>{String(stats.responses)}</dd></div>}
      </dl>
      {stats.people > 0 && (
        <div class="results-table insights-coverage">
          <table>
            <caption>{coverageCaption(stats)} <span class="hint">Darker cells: more people.</span></caption>
            <thead><tr><th scope="col">Dimension</th>{stats.coverage[0].levels.map((cell) => <th scope="col">{cell.level}</th>)}</tr></thead>
            <tbody>
              {stats.coverage.map((row) => (
                <tr>
                  <th scope="row">{row.dimension}</th>
                  {row.levels.map((cell) => <td data-share={Math.min(4, Math.ceil(percent(cell.people, stats.people) / 25))}>{String(cell.people)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {stats.tools.length > 0 && (
        <>
          <p class="hint" id="glance-tools">{toolsCaption}</p>
          <ul class="results-bars" aria-labelledby="glance-tools">
            {stats.tools.map((tool) => (
              <li>
                <span class="results-label">{tool.name}</span>
                <progress max={stats.people} value={tool.people} aria-label={`${tool.name}: ${tool.people} of ${stats.people} people`}>{`${percent(tool.people, stats.people)}%`}</progress>
                <span class="results-count">{`${tool.people} of ${stats.people}`}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

// Headings carry the structure (h2 source, h3 person or wave, h4 part); only the page's sections are landmarks.
// A group's qualitative answers for interviewers, exactly as the Markdown download holds them.
export function InsightsPage({ insights }: { insights: Insights }) {
  const { group } = insights;
  const prefix = groupPrefix(group?.slug);
  const about = preamble(insights);
  const glance = insights.stats.people > 0 || insights.stats.responses > 0;
  const sections = [
    ...(glance ? [{ id: 'glance', title: 'At a glance' }] : []),
    { id: 'about', title: 'About this file' },
    { id: 'interviews', title: `Interviews (${insights.interviews.length})` },
    { id: 'maps', title: `Self-submitted maps (${insights.maps.length})` },
    ...(group ? [{ id: 'survey', title: `Survey free text (${insights.waves.length})` }] : []),
  ];
  return (
    <Layout title={`Insights · ${groupLabel(group)}`}>
      <main class="groups-page results-page insights-page">
        <header class="groups-head">
          <img src={asset('img/variant-logo-dark.svg')} alt="Variant" width="101" height="24" />
          <h1>{`Insights: ${groupLabel(group)}`}</h1>
          <p id="insights-summary">{summaryLine(insights)}</p>
        </header>

        <div class="insights-download">
          <a class="btn" data-variant="primary" href={`${prefix}/insights.md`} download id="insights-download" aria-describedby="insights-download-hint">Download Markdown</a>
          <p class="hint" id="insights-download-hint">One .md file with everything on this page, ready for an LLM. Names, interviewers and private notes are left out.</p>
        </div>

        <nav class="insights-toc" aria-label="On this page">
          <ul>
            {sections.map((section) => <li><a href={`#${section.id}`}>{section.title}</a></li>)}
          </ul>
        </nav>

        {glance && <Glance insights={insights} />}

        <section class="results-section insights-about" id="about" aria-labelledby="about-heading">
          <h2 id="about-heading">About this file</h2>
          <p>{about.intro}</p>
          <p>{about.layout}</p>
          <p>{about.privacy}</p>
          <div class="insights-tables">
            {about.tables.map((table) => (
              <div>
                <h3>{table.title}</h3>
                <ul>{table.items.map((item) => <li>{item}</li>)}</ul>
              </div>
            ))}
          </div>
        </section>

        <People id="interviews" title="Interviews" people={insights.interviews} none="No interviews with answers." />
        <People id="maps" title="Self-submitted maps" people={insights.maps} none="No self-submitted maps with answers." />

        {group && (
          <section class="results-section" id="survey" aria-labelledby="survey-heading">
            <h2 id="survey-heading">Survey free text</h2>
            {insights.waves.length === 0 && <p class="empty-note">No survey waves.</p>}
            {insights.waves.map((wave, i) => (
              <article class="insights-person" aria-labelledby={`wave-${i + 1}-heading`}>
                <h3 id={`wave-${i + 1}-heading`}>{wave.name}</h3>
                <p class="hint">{`${waveMeta(wave)}.`}</p>
                {wave.hidden ? <p class="empty-note">{tooFewText}</p> : wave.questions.map((question) => (
                  <div class="insights-part">
                    <h4>{question.prompt}</h4>
                    {question.answers.length ? <ul class="results-texts">{question.answers.map((answer) => <li class="insights-text">{answer}</li>)}</ul> : <p class="hint">No answers.</p>}
                  </div>
                ))}
              </article>
            ))}
          </section>
        )}

        <nav class="groups-foot" aria-label="More">
          <a href={`${prefix}/interviews`}>Interviews</a>
          <a href={`${prefix}/submissions`}>Self-submitted maps</a>
          {group && <a href={`${prefix}/waves`}>Survey</a>}
          <a href="/groups">All groups</a>
        </nav>
      </main>
    </Layout>
  );
}
