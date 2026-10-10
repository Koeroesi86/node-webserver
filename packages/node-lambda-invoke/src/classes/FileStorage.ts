import { writeFile, readFile, rm } from 'fs/promises';
import { resolve } from 'path';
import type RequestEvent from './RequestEvent';
import type ResponseEvent from './ResponseEvent';
import type { StorageInstance } from '../types';

const serializer = {
  serialize: (data: unknown) => JSON.stringify(data),
  deserialize: <T>(data: string): T => JSON.parse(data),
};

/**
 * Keeps the request and the response in files in a folder of the lambda, which the server makes for it and removes with it.
 * Loaded by file path, so it has to stay a CommonJS `module.exports`.
 */
class FileStorage {
  readonly folder: string;

  constructor(readonly id: string, readonly instance: StorageInstance, folder?: string) {
    if (folder === undefined) throw new Error('The file storage needs the folder of the lambda.');

    this.folder = folder;
    this.setResponse = this.setResponse.bind(this);
    this.getResponse = this.getResponse.bind(this);
    this.setRequest = this.setRequest.bind(this);
    this.getRequest = this.getRequest.bind(this);
    this.destroy = this.destroy.bind(this);
  }

  get requestPath(): string {
    return resolve(this.folder, `request-${this.id}`);
  }

  get responsePath(): string {
    return resolve(this.folder, `response-${this.id}`);
  }

  setResponse(response: ResponseEvent): Promise<void> {
    return writeFile(this.responsePath, serializer.serialize(response), 'utf8');
  }

  getResponse(): Promise<ResponseEvent> {
    return readFile(this.responsePath, 'utf8').then((data) => serializer.deserialize<ResponseEvent>(data));
  }

  setRequest(request: RequestEvent): Promise<void> {
    return writeFile(this.requestPath, serializer.serialize(request), 'utf8');
  }

  getRequest(): Promise<RequestEvent> {
    return readFile(this.requestPath, 'utf8').then((data) => serializer.deserialize<RequestEvent>(data));
  }

  // both the lambda and the middleware destroy the storage of a request, so the files may be gone already, which is not an error
  destroy(): Promise<[void, void]> {
    return Promise.all([rm(this.responsePath, { force: true }), rm(this.requestPath, { force: true })]);
  }
}

export = FileStorage;
