import Head from "next/head";
import type { NextPageContext } from "next";

type ErrorPageProps = {
  statusCode?: number;
};

export default function ErrorPage({ statusCode }: ErrorPageProps) {
  const title = statusCode ? `Error ${statusCode}` : "Application error";

  return (
    <>
      <Head>
        <title>{title}</title>
      </Head>
      <main style={{ margin: "0 auto", maxWidth: 720, padding: "48px 24px" }}>
        <h1>{title}</h1>
        <p>Sorry, something went wrong while loading this page.</p>
      </main>
    </>
  );
}

ErrorPage.getInitialProps = ({ res, err }: NextPageContext) => {
  const statusCode = res?.statusCode ?? err?.statusCode ?? 404;
  return { statusCode };
};
