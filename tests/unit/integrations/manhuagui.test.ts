import { beforeEach } from 'vitest';
import { registerManhuaguiCases } from './manhuagui.cases';
import { resetManhuaguiTestEnvironment } from './manhuagui-test-setup';

beforeEach(() => {
  resetManhuaguiTestEnvironment();
});

registerManhuaguiCases();
