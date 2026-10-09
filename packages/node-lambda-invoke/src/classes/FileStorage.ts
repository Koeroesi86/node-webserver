import { resolve } from 'path';
import { readFile, writeFile, existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { rm } from 'fs/promises';
import { PACKAGE_ROOT } from '../constants';
import type RequestEvent from './RequestEvent';
import type ResponseEvent from './ResponseEvent';

const serializer = {
  serialize: (data: unknown) => JSON.stringify(data),
  deserialize: <T>(data: string): T => JSON.parse(data),
};

const Driver = {
  save: (path: string, data: string) => new Promise<void>((res, rej) => writeFile(path, data, 'utf8', (err) => (err ? rej(err) : res()))),
  restore: (path: string) => new Promise<string>((res, rej) => readFile(path, 'utf8', (err, data) => (err ? rej(err) : res(data)))),
  // both the lambda and the middleware destroy the storage of a request, so the file may be gone already, which is not an error
  destroy: (path: string) => rm(path, { force: true }),
};

/** loaded by file path, so it has to stay a CommonJS `module.exports` */
class FileStorage {
  static requestBase = resolve(PACKAGE_ROOT, 'requests/');
  static responseBase = resolve(PACKAGE_ROOT, 'responses/');

  static start() {
    [FileStorage.requestBase, FileStorage.responseBase]
      .filter((base) => existsSync(base))
      .forEach((base) => readdirSync(base).forEach((name) => rmSync(resolve(base, name), { recursive: true, force: true })));

    if (!existsSync(FileStorage.requestBase)) mkdirSync(FileStorage.requestBase, { recursive: true });
    if (!existsSync(FileStorage.responseBase)) mkdirSync(FileStorage.responseBase, { recursive: true });
  }

  constructor(readonly id: string) {
    this.setResponse = this.setResponse.bind(this);
    this.getResponse = this.getResponse.bind(this);
    this.setRequest = this.setRequest.bind(this);
    this.getRequest = this.getRequest.bind(this);
    this.destroy = this.destroy.bind(this);
  }

  get requestPath(): string {
    return resolve(FileStorage.requestBase, `./${this.id}`);
  }

  get responsePath(): string {
    return resolve(FileStorage.responseBase, `./${this.id}`);
  }

  setResponse(response: ResponseEvent): Promise<void> {
    return Driver.save(this.responsePath, serializer.serialize(response));
  }

  getResponse(): Promise<ResponseEvent> {
    return Driver.restore(this.responsePath).then((data) => serializer.deserialize<ResponseEvent>(data));
  }

  setRequest(request: RequestEvent): Promise<void> {
    return Driver.save(this.requestPath, serializer.serialize(request));
  }

  getRequest(): Promise<RequestEvent> {
    return Driver.restore(this.requestPath).then((data) => serializer.deserialize<RequestEvent>(data));
  }

  destroy(): Promise<[void, void]> {
    return Promise.all([Driver.destroy(this.responsePath), Driver.destroy(this.requestPath)]);
  }
}

export = FileStorage;
