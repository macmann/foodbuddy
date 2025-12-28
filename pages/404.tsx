import Head from "next/head";

export default function NotFoundPage() {
  return (
    <>
      <Head>
        <title>Page not found</title>
      </Head>
      <main style={{ margin: "0 auto", maxWidth: 720, padding: "48px 24px" }}>
        <h1>Page not found</h1>
        <p>The page you requested doesn&apos;t exist.</p>
      </main>
    </>
  );
}
