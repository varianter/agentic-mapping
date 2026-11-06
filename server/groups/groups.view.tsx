import { groupPrefix, mapPath, type Group } from '../domain/groups';
import { asset } from '../framework/assets';
import type { FormState } from '../framework/formAction';
import { Layout } from '../shell/Layout';

export type GroupRow = { group: Group | null; interviews: number; maps: number };

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const text = (form: FormState, name: string) => (typeof form.values[name] === 'string' ? form.values[name] as string : '');

// The interviewer's start page: one workspace per company, each with the link its people open, plus the sheets
// without a group. `renaming` is the group whose rename form `form` belongs to; otherwise it is the create form.
export function GroupsPage({ rows, origin, renaming, form }: { rows: GroupRow[]; origin: string; renaming?: string; form: FormState }) {
  const creating = renaming === undefined;
  const error = (name: string) => form.fieldErrors[name]?.[0];
  return (
    <Layout title="Groups" scripts={['elements/copy-button.js']}>
      <main class="groups-page">
        <header class="groups-head">
          <img src={asset('img/variant-logo-dark.svg')} alt="Variant" width="101" height="24" />
          <h1>Groups</h1>
          <p>Each group has its own interviews and self-submitted maps. Share a group’s link with the people taking part: what they fill in is saved in that group.</p>
        </header>

        <section class="group-new" aria-labelledby="group-new-label">
          <h2 id="group-new-label">New group</h2>
          {creating && form.formError && <p class="form-error" role="alert">{form.formError}</p>}
          <form method="post" action="/groups" id="group-create">
            <div class="field">
              <label class="lbl" for="group-name">Name</label>
              <input type="text" id="group-name" name="name" value={creating ? text(form, 'name') : ''} placeholder="Company A" required aria-invalid={creating && error('name') ? 'true' : undefined} />
            </div>
            <div class="field">
              <label class="lbl" for="group-slug">Id in the link</label>
              <input type="text" id="group-slug" name="slug" value={creating ? text(form, 'slug') : ''} placeholder="From the name" autocapitalize="none" spellcheck={false} aria-describedby="group-slug-hint" aria-invalid={creating && error('slug') ? 'true' : undefined} />
              <p class="hint" id="group-slug-hint">{`${origin}/company-a. Letters, digits and hyphens; it can’t change later.`}</p>
            </div>
            <div class="actions"><button type="submit" class="btn" data-variant="primary">Create group</button></div>
          </form>
        </section>

        <ul class="group-list" id="group-list" aria-label="Groups">
          {rows.map(({ group, interviews, maps }) => {
            const prefix = groupPrefix(group?.slug);
            const id = group ? `group-${group.slug}` : 'group-none';
            const editing = group && renaming === group.slug;
            return (
              <li id={id}>
                <div class="group-row-head">
                  <h2>{group ? group.name : 'No group'}</h2>
                  <p class="hint">{`${plural(interviews, 'interview', 'interviews')} · ${plural(maps, 'self-submitted map', 'self-submitted maps')}`}</p>
                </div>
                <nav class="group-row-links" aria-label={group ? group.name : 'No group'}>
                  <a class="btn" data-variant="small" href={`${prefix}/interviews`}>Interviews</a>
                  <a class="btn" data-variant="small" href={`${prefix}/submissions`}>Self-submitted maps</a>
                </nav>
                <copy-button for={`${id}-link`} what="group link" class="connect-link-row">
                  <label class="visually-hidden" for={`${id}-link`}>{`Link for ${group ? group.name : 'maps without a group'}`}</label>
                  <input type="text" id={`${id}-link`} value={`${origin}${mapPath(group?.slug)}`} readonly autocomplete="off" spellcheck={false} />
                  <button type="button" class="btn" data-variant="small">Copy</button>
                </copy-button>
                {group && (
                  <form method="post" action={`/groups/${group.slug}`} class="group-rename">
                    {editing && form.formError && <p class="form-error" role="alert">{form.formError}</p>}
                    <label class="visually-hidden" for={`${id}-name`}>{`New name for ${group.name}`}</label>
                    <input type="text" id={`${id}-name`} name="name" value={editing ? text(form, 'name') : group.name} required />
                    <button type="submit" class="btn" data-variant="small">Rename</button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>

        <nav class="groups-foot" aria-label="More">
          <a href="/guide">Interviewer guide</a>
          <form method="post" action="/sign-out"><button type="submit" class="link-button" id="sign-out">Sign out</button></form>
        </nav>
      </main>
    </Layout>
  );
}
