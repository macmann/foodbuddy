export type RequestContext = {
  requestId: string;
  startTime: number;
};

export const createRequestContext = (request: Request): RequestContext => {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  return { requestId, startTime: Date.now() };
};
