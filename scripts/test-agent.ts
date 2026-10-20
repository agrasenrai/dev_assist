// Compatibility entrypoint: always use the isolated database test runner.
process.argv[2] = 'agent';
await import('./run-tests.js');
export {};
