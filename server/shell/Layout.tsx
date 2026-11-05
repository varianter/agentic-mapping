import type { Child } from 'hono/jsx';
import { useRequestContext } from 'hono/jsx-renderer';
import { asset } from '../framework/assets';

// Every page's document. Scripts are progressive enhancements (custom elements); pages work without them.
export function Layout({ title, scripts = [], children }: { title: string; scripts?: string[]; children: Child }) {
  const c = useRequestContext();
  const styles = asset('styles.css');
  const modules = scripts.map(asset);
  c.header('Link', [`<${styles}>; rel=preload; as=style`, ...modules.map((src) => `<${src}>; rel=modulepreload`)].join(', '));
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${title} · Agentic mapping`}</title>
        <link rel="icon" href={asset('img/favicon.svg')} type="image/svg+xml" />
        <link rel="stylesheet" href={styles} />
        {modules.map((src) => <script type="module" src={src}></script>)}
      </head>
      <body>{children}</body>
    </html>
  );
}
