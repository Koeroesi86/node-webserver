const uuid = require('uuid/v4');
const { Worker } = require('@koeroesi86/node-lambda-invoke');
const stdoutListener = require('../middlewares/stdoutListener');

const workerInstances = {};

function getOverallCount() {
  return Object.keys(workerInstances).reduce((result, current) => Object.keys(workerInstances[current]).length + result, 0);
}

function getNonBusyId(workerPath) {
  return Object.keys(workerInstances[workerPath] || {}).find(id => {
    return !workerInstances[workerPath][id].busy;
  });
}

class WorkerPool {
  constructor({ overallLimit = 0, idleCheckTimeout = 5, logger = () => {} }) {
    this.overallLimit = overallLimit;
    this.idleCheckTimeout = idleCheckTimeout;
    this.logger = logger;

    this.getWorker = this.getWorker.bind(this);
    this.createWorker = this.createWorker.bind(this);
  }

  createWorker(workerPath, handlerKey) {
    return new Promise(resolve => {
      const currentId = uuid();
      const currentWorkerInstance = new Worker(workerPath, handlerKey, this.logger);

      currentWorkerInstance.addEventListenerOnce('close', code => {
        if (code) this.logger(`[${currentId}] Worker exited with code ${code}`);
      });
      resolve({ id: currentId, instance: currentWorkerInstance });

      stdoutListener(currentWorkerInstance, this.logger);
    });
  }

  getWorker(workerPath, options = {}, limit = 0) {
      const nonBusyId = getNonBusyId(workerPath);
      // TODO: tidy up
      if (
        (workerInstances[workerPath] && limit > 0 && Object.keys(workerInstances[workerPath]).length >= limit)
        || (this.overallLimit > 0 && getOverallCount() >= this.overallLimit)
      ) {
        return Promise.resolve()
          .then(() => new Promise(r => setTimeout(r, this.idleCheckTimeout)))
          .then(() => this.getWorker(workerPath, options));
      } else if (!workerInstances[workerPath] || !nonBusyId) {
        return Promise.resolve()
          .then(() => this.createWorker(workerPath, options, limit))
          .then(({ id, instance }) => {
            workerInstances[workerPath] = {
              ...(workerInstances[workerPath] && workerInstances[workerPath]),
              [id]: instance,
            };
            instance.addEventListenerOnce('close', () => {
              delete workerInstances[workerPath][id];
            });

            return Promise.resolve(instance);
          });
      } else if(nonBusyId) {
        return Promise.resolve(workerInstances[workerPath][nonBusyId]);
      }

      return Promise.reject();
  }
}

module.exports = WorkerPool;
