type SearchParams = URLSearchParams | Record<string, string | string[] | undefined>;

type PageParams = {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
};

const getParam = (searchParams: SearchParams, key: string): string | undefined => {
  if (searchParams instanceof URLSearchParams) {
    return searchParams.get(key) ?? undefined;
  }

  const value = searchParams[key];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
};

const parsePositiveInt = (value: string | undefined, fallback: number) => {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

export const parsePageParams = (searchParams: SearchParams): PageParams => {
  const page = parsePositiveInt(getParam(searchParams, "page"), 1);
  const pageSize = Math.min(
    parsePositiveInt(getParam(searchParams, "pageSize"), 20),
    100,
  );

  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize,
  };
};

export type { PageParams };
