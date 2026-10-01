import { resolve } from 'path';
import { PACKAGE_ROOT } from '../constants';
import type { RequestEvent, ResponseEvent } from '@koeroesi86/node-worker-express';
import serializer from './serializer';
import fileDriver from './fileDriver';
import type { StorageDriver } from '../types';

/** loaded by file path in the lambda workers, so it has to stay a CommonJS `module.exports` */
class Storage {
  readonly driver: StorageDriver;

  constructor(readonly id: string, driver?: StorageDriver) {
    this.driver = driver || fileDriver;

    this.setResponse = this.setResponse.bind(this);
    this.getResponse = this.getResponse.bind(this);
    this.setRequest = this.setRequest.bind(this);
    this.getRequest = this.getRequest.bind(this);
    this.destroy = this.destroy.bind(this);
  }

  get requestPath(): string {
    return resolve(PACKAGE_ROOT, `./requests/${this.id}`);
  }

  get responsePath(): string {
    return resolve(PACKAGE_ROOT, `./responses/${this.id}`);
  }

  setResponse(response: ResponseEvent): Promise<void> {
    return this.driver.save(this.responsePath, serializer.serialize(response));
  }

  getResponse(): Promise<ResponseEvent> {
    return this.driver.restore(this.responsePath).then((data) => serializer.deserialize<ResponseEvent>(data));
  }

  setRequest(request: RequestEvent): Promise<void> {
    return this.driver.save(this.requestPath, serializer.serialize(request));
  }

  getRequest(): Promise<RequestEvent> {
    return this.driver.restore(this.requestPath).then((data) => serializer.deserialize<RequestEvent>(data));
  }

  destroy(): Promise<[void, void]> {
    return Promise.all([this.driver.destroy(this.responsePath), this.driver.destroy(this.requestPath)]);
  }
}

export = Storage;
