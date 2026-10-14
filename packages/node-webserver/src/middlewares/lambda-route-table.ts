import fs from 'fs';
import { createRouteMatcher } from '@koeroesi86/node-worker-express';
import type { HttpMiddleware } from '@koeroesi86/node-lambda-invoke';
import type { LambdaRoute } from '../types';

const validateLambdaRoute: (lambda: unknown, position: number) => asserts lambda is string = (lambda, position) => {
  if (typeof lambda !== 'string' || lambda === '') {
    throw new Error(`routes[${position}] has no lambda.`);
  }
  if (!fs.statSync(lambda, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`The lambda of routes[${position}] is not a file: ${lambda}`);
  }
};

/** Compiles route targets at startup, validating each lambda before requests are dispatched. */
const createLambdaRouteTable = (routes: LambdaRoute[], createTarget: (route: LambdaRoute, position: number) => HttpMiddleware, started: HttpMiddleware[]) =>
  createRouteMatcher(routes, (route, position) => {
    validateLambdaRoute(route.lambda, position);
    const target = createTarget(route, position);
    started.push(target);
    return target;
  });

export default createLambdaRouteTable;
