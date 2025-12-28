import Head from "next/head";

export default function ServerErrorPage() {
  return (
    <>
      <Head>
        <title>Server error</title>
      </Head>
      <main style={{ margin: "0 auto", maxWidth: 720, padding: "48px 24px" }}>
        <h1>Server error</h1>
        <p>We hit an unexpected issue. Please try again later.</p>
      </main>
    </>
  );
}
