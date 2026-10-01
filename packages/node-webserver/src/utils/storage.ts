import { resolve } from 'path';
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
    return resolve('D:/Chris/Documents/Developement/node-webserver/', `./requests/${this.id}`);
  }

  get responsePath(): string {
    return resolve('D:/Chris/Documents/Developement/node-webserver/', `./responses/${this.id}`);
  }

  setResponse(response: Middleware.ResponseEvent): Promise<void> {
    return this.driver.save(this.responsePath, serializer.serialize(response));
  }

  getResponse(): Promise<Middleware.ResponseEvent> {
    return this.driver.restore(this.responsePath).then((data) => serializer.deserialize<Middleware.ResponseEvent>(data));
  }

  setRequest(request: Middleware.RequestEvent): Promise<void> {
    return this.driver.save(this.requestPath, serializer.serialize(request));
  }

  getRequest(): Promise<Middleware.RequestEvent> {
    return this.driver.restore(this.requestPath).then((data) => serializer.deserialize<Middleware.RequestEvent>(data));
  }

  destroy(): Promise<[void, void]> {
    return Promise.all([this.driver.destroy(this.responsePath), this.driver.destroy(this.requestPath)]);
  }
}

export = Storage;
