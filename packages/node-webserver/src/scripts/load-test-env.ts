/**
 * The logger reads its levels from NODE_WEBSERVER_CONFIG as soon as it is imported,
 * so this module has to be imported before anything that uses the logger.
 */
process.env.NODE_WEBSERVER_CONFIG ??= '../configuration.load-test';
