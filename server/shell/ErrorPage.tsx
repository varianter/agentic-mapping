import { Layout } from './Layout';

export function ErrorPage({ title, message }: { title: string; message: string }) {
  return (
    <Layout title={title}>
      <main class="notice">
        <h1>{title}</h1>
        <p>{message}</p>
        <p><a href="/">Go to My map</a></p>
      </main>
    </Layout>
  );
}
