import type { Context } from 'hono';
import type { FC } from 'hono/jsx';
import { z } from 'zod';
import type { AppEnv } from './env';
import { wantsJson } from './respond';

export type Values = Record<string, string | string[]>;
export type FieldErrors = Record<string, string[]>;
export type FormState = { values: Values; fieldErrors: FieldErrors; formError?: string; saved: boolean };
export type SubmitResult =
  | { redirect: string; json?: unknown }
  | { formError?: string; fieldErrors?: FieldErrors; status?: 401 | 404 | 409 | 422 };

// Submitted values as typed, for re-rendering; never trusted. Repeated names stay arrays.
export async function formValues(c: Context): Promise<Values> {
  const body = await c.req.parseBody({ all: true }).catch(() => ({}));
  return Object.fromEntries(Object.entries(body).flatMap(([key, value]) => {
    if (Array.isArray(value)) return [[key, value.filter((item): item is string => typeof item === 'string')]];
    return typeof value === 'string' ? [[key, value]] : [];
  }));
}

// One URL per form. GET renders it; POST validates, submits, then redirects (303), or re-renders with what was
// typed and the errors (409/422). Scripts send the same body with `Accept: application/json` and get JSON back.
// `loader` gives what both submitting and the view need; `page` adds what only a rendered page needs, so
// redirects and JSON replies skip it.
export function formAction<S extends z.ZodType, P extends object, V extends object = {}>({ schema, loader, page, onSubmit, view: View }: {
  schema: S;
  loader: (c: Context<AppEnv>) => Promise<P | Response>;
  page?: (c: Context<AppEnv>, props: P) => Promise<V>;
  onSubmit: (c: Context<AppEnv>, data: z.infer<S>, props: P) => Promise<SubmitResult>;
  view: FC<P & V & { form: FormState }>;
}) {
  const render = async (c: Context<AppEnv>, props: P, form: FormState) => {
    const extra = (await page?.(c, props)) ?? ({} as V);
    return c.render(<View {...props} {...extra} form={form} />);
  };
  return async (c: Context<AppEnv>) => {
    const props = await loader(c);
    if (props instanceof Response) return props;
    if (c.req.method === 'GET') return render(c, props, { values: {}, fieldErrors: {}, saved: c.req.query('saved') !== undefined });
    const values = await formValues(c);
    const parsed = schema.safeParse(values);
    const flattened = parsed.success ? undefined : z.flattenError(parsed.error);
    const fieldErrors = flattened?.fieldErrors as FieldErrors | undefined;
    const validationMessages = [
      ...(flattened?.formErrors ?? []),
      ...Object.entries(fieldErrors ?? {}).flatMap(([field, messages]) => messages.map((message) => `${field}: ${message}`)),
    ];
    const result: SubmitResult = parsed.success
      ? await onSubmit(c, parsed.data, props)
      : { fieldErrors, formError: validationMessages.join(' ') || 'Check the highlighted fields.', status: 422 };
    if ('redirect' in result) return wantsJson(c) ? c.json(result.json ?? { ok: true }) : c.redirect(result.redirect, 303);
    const status = result.status ?? 422;
    if (wantsJson(c)) return c.json({ error: result.formError, fieldErrors: result.fieldErrors ?? {} }, status);
    c.status(status);
    return render(c, props, { values, fieldErrors: result.fieldErrors ?? {}, formError: result.formError, saved: false });
  };
}
