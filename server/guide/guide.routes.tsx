import { Hono } from 'hono';
import { asset } from '../framework/assets';
import type { AppEnv } from '../framework/env';
import { DIMENSIONS, LEVELS, QUESTIONS } from '../domain/fields';
import { Layout } from '../shell/Layout';

const LEVEL_DETAIL: Record<string, string> = {
  start: 'The first weeks of working with agents',
  good: 'Working this way every day, at the quality clients expect',
  next: 'What they are reaching for now',
};
const DIMENSION_DETAIL: Record<string, string> = {
  ind: 'How they work on their own: their habits, judgement and craft with agents.',
  team: 'How the team works together: reviews, handovers, shared rules and roles.',
  org: 'What the organization enables or gets in the way of: access, policy, clients, how work is bought and measured.',
};
const STEPS = [
  { time: '0–2 min', title: 'Context', lines: ['“What is your role, and what are you working on right now?”', '“What does really good look like to you, when someone works with agents in your discipline?”'] },
  { time: '2–8 min', title: 'Looking back', lines: ['“What did you have to learn to get where you are? What came first?”', 'For each thing: “What goes wrong if you skip it? How did you find out you needed it?”', 'Then widen it: “What did your team have to learn? And the organization around you?”'] },
  { time: '8–12 min', title: 'Looking ahead', lines: ['“What would the next level look like for you?”', '“What do you think you need to learn to get there? What would the team, or the organization, need to change?”', '“What do you suspect you’re still missing?”'] },
  { time: '12–15 min', title: 'Surprises and advice', lines: ['“What surprised you most along the way?”', '“Someone in your discipline starts tomorrow. What should they learn first, and what can wait?”', '“Who else should I talk to?”'] },
];
const RULES = [
  { title: 'Don’t lead', text: 'Don’t offer examples or name tools. If they stall, ask about one recent piece of work instead.' },
  { title: 'Their words', text: 'Write down what they say, as they say it. Don’t teach or argue; save disagreements for the group session.' },
  { title: 'Sort afterwards', text: 'Categories come from the answers, not from us. Group the notes across conversations once they’re all in.' },
];

function GuidePage() {
  return (
    <Layout title="Interviewer guide">
      <main class="guide">
        <div class="guide-top">
          <img src={asset('img/variant-logo-dark.svg')} alt="Variant" width="126" height="30" />
          <a href="/">← Capture sheets</a>
        </div>

        <header>
          <div class="guide-tags">
            <span class="pill">Round 1 of 2</span>
            <span class="lbl">Fag · Agentic product development</span>
          </div>
          <h1>What did you need to learn? A 15-minute mapping</h1>
          <p class="lead">We don’t bring a list of tools or methods. We want to hear what you had to learn to work well with agents, what you’re still missing, and what took you by surprise. Put together, the answers become a learning path for developers, designers and product people, and a map of the unknown unknowns.</p>
        </header>

        <section>
          <div class="stack">
            <h2>The model: three levels, three questions, three dimensions</h2>
            <p class="sub">The same three questions at each level, asked for the individual, the team and the organization. What goes in the boxes comes from them.</p>
          </div>
          <div class="guide-model">
            <div class="spacer"></div>
            {LEVELS.map((level) => <div class="level"><strong>{level.name}</strong><span>{LEVEL_DETAIL[level.key]}</span></div>)}
            {QUESTIONS.map((question) => (
              <>
                <div class="q"><strong>{question.name}</strong>{question.hint && <span>{question.hint}</span>}</div>
                {LEVELS.map(() => <div class="slot"></div>)}
              </>
            ))}
          </div>
          <div class="stack">
            <p class="sub">Working with agents changes things on three axes, and what you need to learn differs on each. Fill in the grid once per dimension.</p>
            <div class="guide-dims">
              {DIMENSIONS.map((dimension) => <div><span class="dim-label">{dimension.name}</span><p>{DIMENSION_DETAIL[dimension.key]}</p></div>)}
            </div>
          </div>
          <div class="callout">
            <strong>Unknown unknowns</strong>
            <p>The third row and the last block are where these show up: things nobody told them they needed, found by hitting a wall, a bug, a confused client or a colleague who worked differently.</p>
          </div>
        </section>

        <section>
          <h2>Run of show</h2>
          <ol class="steps">
            {STEPS.map((step) => (
              <li><span class="time">{step.time}</span><div><h3>{step.title}</h3><p>{step.lines.map((line, index) => <>{index > 0 && <br />}{line}</>)}</p></div></li>
            ))}
          </ol>
        </section>

        <section class="rules" aria-label="Ground rules">
          {RULES.map((rule) => <div><strong>{rule.title}</strong><p>{rule.text}</p></div>)}
        </section>
      </main>
    </Layout>
  );
}

export const guideRoutes = new Hono<AppEnv>()
  .get('/guide', (c) => c.render(<GuidePage />))
  // Old links to the static file keep working.
  .get('/guide.html', (c) => c.redirect('/guide', 301));
