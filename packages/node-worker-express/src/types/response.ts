import type { Readable } from 'stream';
import type { WorkerRequestEvent } from './request';

export type ResponseEvent = {
  statusCode: number;
  headers?: { [key: string]: string };
  /** whether a string `body` is base64, ignored for a Buffer */
  isBase64Encoded?: boolean;
  emit?: boolean;
  /** a Buffer is sent as it is, a string is utf8 unless `isBase64Encoded`, and null ends a streamed response */
  body?: string | Buffer | null;
};

/** a response as it travels from the worker to the server: the body is raw bytes, and null ends a streamed response */
export type ResponseMessage = Omit<ResponseEvent, 'body' | 'isBase64Encoded'> & { body?: Buffer | null };

/**
 * What a worker sends to a websocket client: a message, or the end of the connection. A string `frame` is sent as a text message, a Buffer as a binary one.
 * The promise `callback` returns resolves when the message was written to the client (`true`), or when the connection is gone (`false`).
 * A worker that sends faster than the client takes waits for it, so the memory stays flat.
 */
export type WSFrameEvent = {
  sendWsMessage: boolean;
  frame?: string | Buffer;
  /** closes the connection after the messages sent before, `code` defaults to 1000 */
  close?: { code?: number; reason?: string };
};

/** a message to a websocket client as it travels from the worker to the server: the body is a text message when it is a string and a binary one when it is a Buffer */
export type WSMessage = {
  body?: Buffer | string;
  close?: { code?: number; reason?: string };
};

/**
 * Asks to write the body of a streamed response to the client directly, instead of sending it through the server. The promise `callback` returns resolves
 * with the socket of the client, with the head of the response written already, or with anything else when the server keeps the connection: then the body is streamed as usual.
 * `streamResponse` does this by itself for a response with a `Content-Length`.
 */
export type HandOffEvent = {
  statusCode: number;
  headers?: { [key: string]: string };
  handOff: true;
};

/**
 * Answers the request. A response with `emit` streams the body in parts, ending with a part without a body.
 * For those the returned promise resolves when the part was written to the client: `true` to go on, `false` when the client is gone and streaming should stop.
 */
export type ResponseCallback = (e: ResponseEvent | HandOffEvent) => unknown;

/** The function a worker file exports. */
export type InvokableWorker = (event: WorkerRequestEvent, callback: ResponseCallback) => unknown;

export type StreamBody = Readable | AsyncIterable<Buffer | Uint8Array | string>;

export interface StreamResponseOptions {
  statusCode?: number;
  headers?: ResponseEvent['headers'];
  /** how many parts may wait to be written to the client while the next ones are produced. Not limited by default. */
  window?: number;
  /** how many bytes may wait to be written to the client while the next ones are produced, so the pipe stays full. Defaults to 4 MiB. */
  windowBytes?: number;
}
