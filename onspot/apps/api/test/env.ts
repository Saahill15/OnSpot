// Tests run against a separate database and Redis DB 1 so dev data is untouched.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://onspot@localhost:54329/onspot_test?schema=public';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1';
process.env.JWT_SECRET = 'test-secret';
process.env.OTP_DEV_ECHO = 'true';
process.env.DISPATCH_TICK_MS = '300';
process.env.PUSH_DRIVER = 'memory';
