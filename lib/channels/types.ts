export type Channel = "WEB" | "TELEGRAM" | "VIBER" | "MESSENGER";

export type SendMessageInput = {
  channel: Channel;
  recipientId: string;
  text: string;
  metadata?: Record<string, unknown>;
};

export type SendMessageResult = {
  ok: boolean;
  providerMessageId?: string;
};

export type SendMessageFn = (input: SendMessageInput) => Promise<SendMessageResult>;

export const sendMessage: SendMessageFn = async () => {
  throw new Error("sendMessage adapter not implemented yet.");
};
